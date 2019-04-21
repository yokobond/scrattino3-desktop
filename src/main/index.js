import {BrowserWindow, Menu, app, dialog} from 'electron';
import * as path from 'path';
import {format as formatUrl} from 'url';
import {getFilterForExtension} from './FileFilters';
import telemetry from './ScratchDesktopTelemetry';
import MacOSMenu from './MacOSMenu';

const log = require('electron-log');

telemetry.appWasOpened();

const FirmataRPC = require('./firmata-rpc');
const firmataServer = new FirmataRPC();

const startRpcServer = () => {
    firmataServer.startServer()
        .then(() => {
            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
                firmataServer.listBoards()
                    .then(boards => {
                        log.debug(boards);
                    });
            }
        })
        .catch(reason => {
            log.error(reason);
        });
};

// const defaultSize = {width: 1096, height: 715}; // minimum
const defaultSize = {width: 1280, height: 800}; // good for MAS screenshots

const isDevelopment = process.env.NODE_ENV !== 'production';


const createMainWindow = () => {
    const window = new BrowserWindow({
        width: defaultSize.width,
        height: defaultSize.height,
        useContentSize: true,
        show: false
    });
    const webContents = window.webContents;

    if (process.platform === 'darwin') {
        const osxMenu = Menu.buildFromTemplate(MacOSMenu(app));
        Menu.setApplicationMenu(osxMenu);
    }

    if (isDevelopment) {
        const {default: installExtension, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS} = require('electron-devtools-installer');
        const installExtensions = async () => {
            const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
            const extensions = [];
            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
                extensions.push(REACT_DEVELOPER_TOOLS);
                extensions.push(REDUX_DEVTOOLS);
            }
            return Promise
                .all(extensions.map(name => installExtension(name, forceDownload)))
                .catch(log.error);
        };
        installExtensions().then(() => webContents.openDevTools());
        // import('electron-devtools-installer').then(importedModule => {
        //     const {default: installExtension, REACT_DEVELOPER_TOOLS} = importedModule;
        //     installExtension(REACT_DEVELOPER_TOOLS)
        //         .then(name => log.log(`Added browser extension:  ${name}`))
        //         .catch(err => log.log('An error occurred: ', err));
        // });
    }

    webContents.on('devtools-opened', () => {
        window.focus();
        setImmediate(() => {
            window.focus();
        });
    });

    if (isDevelopment) {
        window.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`);
        // window.loadURL(`file://${__dirname}/../../dist/renderer/index.html`);
    } else {
        window.loadURL(formatUrl({
            pathname: path.join(__dirname, 'index.html'),
            protocol: 'file',
            slashes: true
        }));
    }

    webContents.session.on('will-download', (ev, item) => {
        const itemPath = item.getFilename();
        const baseName = path.basename(itemPath);
        const extName = path.extname(baseName);
        if (extName) {
            const extNameNoDot = extName.replace(/^\./, '');
            const options = {
                filters: [getFilterForExtension(extNameNoDot)]
            };
            const userChosenPath = dialog.showSaveDialog(window, options);
            if (userChosenPath) {
                item.setSavePath(userChosenPath);
            } else {
                item.cancel();
            }
        }
    });

    webContents.on('will-prevent-unload', ev => {
        const choice = dialog.showMessageBox(window, {
            type: 'question',
            message: 'Leave Scratch?',
            detail: 'Any unsaved changes will be lost.',
            buttons: ['Stay', 'Leave'],
            cancelId: 0, // closing the dialog means "stay"
            defaultId: 0 // pressing enter or space without explicitly selecting something means "stay"
        });
        const shouldQuit = (choice === 1);
        if (shouldQuit) {
            ev.preventDefault();
        }
    });

    window.once('ready-to-show', () => {
        window.show();
    });

    return window;
};

// quit application when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});

app.on('will-quit', () => {
    telemetry.appWillClose();
});

app.on('before-quit', () => {
    if (firmataServer) {
        firmataServer.release();
    }
});

// global reference to mainWindow (necessary to prevent window from being garbage collected)
let _mainWindow;

// create main BrowserWindow when electron is ready
app.on('ready', () => {
    startRpcServer();
    _mainWindow = createMainWindow();
    _mainWindow.on('closed', () => {
        _mainWindow = null;
    });
});
