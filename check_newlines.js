const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');
let inScript = false;
lines.forEach((line, i) => {
  if (line.includes('<script')) inScript = true;
  if (line.includes('</script')) inScript = false;
  if (inScript) {
    // Check for single or double quotes that aren't closed on the same line
    // but ignoring backticks which are fine.
    // This is a naive check but might find issues.
    const singleQuotes = (line.match(/'/g) || []).length;
    const doubleQuotes = (line.match(/"/g) || []).length;
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
       console.log(`Line ${i+1} might have an unclosed quote: ${line.trim()}`);
    }
  }
});
