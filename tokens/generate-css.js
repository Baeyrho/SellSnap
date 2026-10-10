const fs = require('fs');
const path = require('path');

const colorTokensPath = path.join(__dirname, 'color-tokens');
const typoTokensPath = path.join(__dirname, 'Typography-tokens.json');
const outputPath = path.join(__dirname, 'tokens.css');

// Read JSON files
const colorsJson = JSON.parse(fs.readFileSync(colorTokensPath, 'utf8'));
const typoJson = JSON.parse(fs.readFileSync(typoTokensPath, 'utf8'));

// Helper to resolve color references like "{color.palette.primary.100}"
function resolveColorReference(refString, rootData) {
    if (typeof refString === 'string' && refString.startsWith('{') && refString.endsWith('}')) {
        const pathArray = refString.slice(1, -1).split('.');
        let current = rootData;
        for (const key of pathArray) {
            if (current && current[key] !== undefined) {
                current = current[key];
            } else {
                // Return a CSS variable fallback if path is not fully resolvable
                return `var(--${pathArray.join('-')})`;
            }
        }
        return current; // Return the resolved value
    }
    return refString;
}

// Convert camelCase or spaces to kebab-case
function formatToKebabCase(str) {
    return str
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
}

let cssContent = `/* Auto-generated tokens from design system */\n\n`;

// 1. Process Colors
const rolesLight = colorsJson.color?.role?.light || {};
const rolesDark = colorsJson.color?.role?.dark || {};

cssContent += `:root {\n`;
cssContent += `  /* Light Theme Colors */\n`;
for (const [key, value] of Object.entries(rolesLight)) {
    const resolvedValue = resolveColorReference(value, colorsJson);
    cssContent += `  --color-${formatToKebabCase(key)}: ${resolvedValue};\n`;
}

cssContent += `\n  /* Typography Tokens */\n`;
const typographyData = typoJson.typography || {};

for (const [styleName, styleProperties] of Object.entries(typographyData)) {
    const prefix = formatToKebabCase(styleName);
    for (const [propName, propData] of Object.entries(styleProperties)) {
        if (propData && typeof propData === 'object' && 'value' in propData) {
            let val = propData.value;
            
            // Add 'px' to numbers that represent dimensions
            if (propData.type === 'dimension' && typeof val === 'number') {
                val = val === 0 ? '0' : `${val}px`;
            }
            // Some typography properties shouldn't be wrapped in quotes
            else if (typeof val === 'string' && propData.type !== 'string') {
                // Keep as is if type was not string but value is somehow string
            }
            
            // Font families with spaces need quotes if they don't have them
            if (propName === 'fontFamily' && typeof val === 'string' && val.includes(' ') && !val.includes('"') && !val.includes("'")) {
                val = `"${val}"`;
            }

            cssContent += `  --${prefix}-${formatToKebabCase(propName)}: ${val};\n`;
        }
    }
}
cssContent += `}\n\n`;

// 2. Process Dark Mode Colors
if (Object.keys(rolesDark).length > 0) {
    let darkVars = '';
    for (const [key, value] of Object.entries(rolesDark)) {
        const resolvedValue = resolveColorReference(value, colorsJson);
        darkVars += `  --color-${formatToKebabCase(key)}: ${resolvedValue};\n`;
    }

    cssContent += `.dark, [data-theme="dark"] {\n`;
    cssContent += `  /* Dark Theme Colors */\n`;
    cssContent += darkVars;
    cssContent += `}\n\n`;

    cssContent += `@media (prefers-color-scheme: dark) {\n`;
    cssContent += `  :root:not(.light) {\n`;
    cssContent += darkVars;
    cssContent += `  }\n`;
    cssContent += `}\n`;
}

fs.writeFileSync(outputPath, cssContent, 'utf8');
console.log(`Successfully generated CSS variables to ${outputPath}`);
