import fs from 'fs';
let content = fs.readFileSync('index.html', 'utf8');

const oldFontLink = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap';
const newFontLink = 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,slnt,wdth,wght,ROND@8..144,-10..0,25..150,400..1000,0..100&display=swap';

content = content.replace(oldFontLink, newFontLink);
content = content.replace("font-family: 'Plus Jakarta Sans'", "font-family: 'Google Sans Flex'");

fs.writeFileSync('index.html', content);
