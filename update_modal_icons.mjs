import fs from 'fs';

function removeIconFromHeader(filePath, iconName) {
  let content = fs.readFileSync(filePath, 'utf8');
  const regex = new RegExp('<div className="p-2[^>]*>\\s*<' + iconName + '[^>]*/>\\s*</div>', 'g');
  content = content.replace(regex, '');
  fs.writeFileSync(filePath, content);
}

removeIconFromHeader('src/components/RuleSuggester.tsx', 'SlidersHorizontal');
removeIconFromHeader('src/components/CategoryDistributionModal.tsx', 'PieChartIcon');
removeIconFromHeader('src/components/HealthScoreModal.tsx', 'Activity');
removeIconFromHeader('src/components/LabelManagerModal.tsx', 'Tag');

