console.log('ELECTRON STARTING');
const { app } = require('electron');
app.whenReady().then(() => {
    console.log('ELECTRON READY');
    process.exit(0);
});
