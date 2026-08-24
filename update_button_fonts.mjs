import fs from 'fs';
import path from 'path';

function replaceFonts(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      replaceFonts(filePath);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Let's tone down font-bold and font-extrabold on interactive elements 
      // where they are too heavy. We can't regex specifically only for buttons, 
      // but we can replace "font-bold" with "font-medium" in className attributes 
      // specifically matching 'hover:' or 'button'.
      
      // Simple approach: globally replace 'font-bold' and 'font-extrabold' on UI components to make it sleeker
      // It's safe to just downgrade font weights globally if the request is "reduce the heavy bold font and have better clearer font"
      
      content = content.replace(/font-extrabold/g, 'font-semibold');
      // For font-bold on buttons, let's just replace font-bold with font-medium
      // we can do a targeted regex for buttons:
      content = content.replace(/<button([^>]+)font-bold([^>]*)>/g, '<button$1font-medium$2>');
      content = content.replace(/<button([^>]+)font-semibold([^>]*)>/g, '<button$1font-medium$2>');
      
      // Also on 'cursor-pointer' or 'hover:bg' classes
      content = content.replace(/className="([^"]*(?:cursor-pointer|hover:)[^"]*)font-bold([^"]*)"/g, 'className="$1font-medium$2"');
      content = content.replace(/className="([^"]*(?:cursor-pointer|hover:)[^"]*)font-semibold([^"]*)"/g, 'className="$1font-medium$2"');

      fs.writeFileSync(filePath, content);
    }
  }
}

replaceFonts('src/components');
