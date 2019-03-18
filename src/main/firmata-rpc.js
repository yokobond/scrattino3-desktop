const Firmata = require('firmata-io').Firmata;
const SerialPort = require('serialport');
const log = require('electron-log');
const JsonRpcWs = require('json-rpc-ws');


class FirmataRPC {
    constructor () {

        this.connectedBoards = {};

        /**
         * port name filter for Arduino
         * @type {RegExp}
         */
        this.arduinoPortPathPattern = /usb|acm|^com/i;
        this.arduinoManufacturePattern = /Arduino/;

        /**
         * SerialPort options for node-serialport.
         * 'baudRate' is corresponding to your Firmata on Arduino.
         * 'autoOpen' must be false in this code.
         * @type {{baudRate: number, autoOpen: boolean, bufferSize: number}}
         */
        this.serialportOptions = {baudRate: 57600, bufferSize: 256};

        this.serverPort = 2020;

        // Start server sequence.
        this.rpcServer = new JsonRpcWs.createServer();
    }

    exposeMethods () {
        this.rpcServer.expose('scan', (params, reply) => {
            this.listBoards()
                .then(boards => {
                    const boardList = {};
                    boards.forEach(board => {
                        const boardProp = this._getBoardProperty(board);
                        boardList[board.transport.path] = boardProp;
                    });
                    reply(null, boardList);
                })
                .catch(reason => {
                    log.error(reason);
                    reply(reason, null);
                });
        });
        this.rpcServer.expose('connect', (params, reply) => {
            if (!params.portPath) {
                reply('portPath is null', null);
            }
            this.connectPort(params.portPath)
                .then(board => {
                    reply(null, this._getBoardProperty(board));
                })
                .catch(reason => {
                    log.error(reason);
                    reply(reason, null);
                });
        });
        this.rpcServer.expose('disconnect', (params, reply) => {
            try {
                this.closeBoardOn(params.portPath);
                reply(null, params);
            } catch (e) {
                reply(e, params);
            }
        });
        this.rpcServer.expose('getBoardState', (params, reply) => {
            reply(null, this.getBoardStateOn(params.portPath));
        });
        this.rpcServer.expose('digitalWrite', (params, reply) => {
            try {
                this.digitalWrite(params.portPath, params.pin, params.value);
                reply(null, params);
            } catch (e) {
                reply(e, params);
            }
        });
        this.rpcServer.expose('pwmWrite', (params, reply) => {
            try {
                this.pwmWrite(params.portPath, params.pin, params.value);
                reply(null, params);
            } catch (e) {
                reply(e, params);
            }
        });
        this.rpcServer.expose('pinMode', (params, reply) => {
            try {
                this.pinMode(params.portPath, params.pin, params.mode);
                reply(null, params);
            } catch (e) {
                reply(e, params);
            }
        });
    }

    startServer () {
        this.exposeMethods();
        return new Promise((resolve, reject) => {

            this.rpcServer.start({port: this.serverPort}, err => {
                if (err) {
                    reject(err);
                }
                log.info(`FirmataRPC Server started on ws://localhost:${this.serverPort}`);
                resolve(this.rpcServer);
            });
        });
    }

    stopServer () {
        this.rpcServer.stop();
    }

    closeBoardOn (portPath) {
        const board = this.connectedBoards[portPath];
        if (!board) return;
        if (board.transport.isOpen) {
            board.transport.close();
        }
        delete this.connectedBoards[portPath];
        log.info(`Close board on ${portPath}`);
    }

    release () {
        this.stopServer();
        Object.keys(this.connectedBoards).forEach(portPath => {
            this.closeBoardOn(portPath);
        });
    }

    async listPorts () {
        const ports = await SerialPort.list();
        return ports.filter(portMetaData => this._checkPortValidation(portMetaData));
    }

    _openTransport (portPath) {
        return new Promise((resolve, reject) => {
            const newPort = new SerialPort(portPath, this.serialportOptions,
                err => {
                    if (err) {
                        log.error(err);
                        reject(err);
                    }
                });
            resolve(newPort);
        });
    }

    _attachFirmata (port) {
        return new Promise((resolve, reject) => {
            const board =
                new Firmata(
                    port,
                    {
                        skipCapabilities: false,
                        reportVersionTimeout: 5000
                    },
                    err => {
                        if (err) {
                            // Called on 'error'
                            log.info(err);
                            reject(err);
                        } else {
                            // Called on 'ready'
                            resolve(board);
                        }
                    });
        });
    }

    _openBoardOn (portPath) {
        return new Promise(async (resolve, reject) => {
            const port = await this._openTransport(portPath);
            try {
                const board = await this._attachFirmata(port);
                resolve(board);
            } catch (err) {
                port.close();
                reject(err);
            }
        });
    }

    async listBoards () {
        const ports = await this.listPorts();
        const boardScanners = ports.map(portMetaData => new Promise(resolve => {
            const portPath = portMetaData.comName;
            if (this.connectedBoards[portPath]) {
                resolve(this.connectedBoards[portPath]);
            }
            this._openBoardOn(portPath)
                .then(board => {
                    log.info(`Found Firmata on ${board.transport.path} : ${board.firmware.name}` +
                        ` v.${board.firmware.version.major}.${board.firmware.version.minor}`);
                    // No more opened port after the board data ware retrieved.
                    board.transport.close();
                    resolve(board);
                })
                .catch(() => {
                    // Return null to be ignored when the port is not a Firmata board.
                    resolve(null);
                });
        }));
        const boards = await Promise.all(boardScanners);
        return boards.filter(board => board !== null);
    }

    _initializeBoard (board) {
        for (let i = 0; i < board.analogPins.length; i++) {
            board.reportAnalogPin(i, 1);
        }
    }

    async connectPort (portPath) {
        let board = this.connectedBoards[portPath];
        if (board) {
            if (board.transport.isOpen) {
                return board;
            }
        }
        board = await this._openBoardOn(portPath);
        this._initializeBoard(board);
        this.connectedBoards[portPath] = board;
        log.info(`Connect to ${board.transport.path} : ${board.firmware.name}` +
            ` v.${board.firmware.version.major}.${board.firmware.version.minor}`);
        return board;
    }

    getBoardStateOn (portPath) {
        const board = this.connectedBoards[portPath];
        if (!board) return null;
        const boardState = {};
        boardState.MODES = board.MODES;
        boardState.pins = board.pins;
        boardState.analogPins = board.analogPins;
        boardState.transport = {
            path: board.transport.path,
            baudRate: board.transport.baudRate,
            isOpen: board.transport.isOpen
        };
        return boardState;
    }

    _checkPortValidation (portMetaData) {
        if (portMetaData.manufacturer) {
            if (portMetaData.manufacturer.match(this.arduinoManufacturePattern)) {
                return true;
            }
        }
        return portMetaData.comName.match(this.arduinoPortPathPattern);
    }

    _getBoardProperty (board) {
        return Object.assign({}, board,
            {
                name: board.transport.path,
                peripheralId: board.transport.path,
                transport: {
                    path: board.transport.path,
                    baudRate: board.transport.baudRate,
                    isOpen: board.transport.isOpen
                }
            }
        );
    }

    digitalWrite (portPath, pin, value) {
        const board = this.connectedBoards[portPath];
        if (!board) throw new Error(`Board not found on ${portPath}`);
        board.digitalWrite(pin, value);
        log.debug(`digitalWrite(${pin}, ${value})`);
    }


    pwmWrite (portPath, pin, value) {
        const board = this.connectedBoards[portPath];
        if (!board) throw new Error(`Board not found on ${portPath}`);
        board.pwmWrite(pin, value);
        log.debug(`pwmWrite(${pin}, ${value})`);
    }

    pinMode (portPath, pin, mode) {
        const board = this.connectedBoards[portPath];
        if (!board) throw new Error(`Board not found on ${portPath}`);
        board.pinMode(pin, mode);
        log.debug(`pinMode(${pin}, ${mode})`);
    }
}

module.exports = FirmataRPC;
