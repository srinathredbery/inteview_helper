const { ipcMain } = require('electron');
// We can't easily trigger this from outside without a running instance
// but we can test the SearchEngine logic directly in node
const SearchEngine = require('./searchengine');
const path = require('path');

const engine = new SearchEngine(path.join(__dirname, 'json', 'hr_interview_questions.json'));
const result = engine.search("What are your weaknesses");
console.log('Result:', result ? 'MATCHED' : 'NOT MATCHED');
if (result) console.log('Question matched:', result.question);
