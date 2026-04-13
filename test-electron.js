const { app } = require('electron');
console.log('Electron starting...');
app.whenReady().then(() => {
    console.log('App ready');
    process.exit(0);
});
