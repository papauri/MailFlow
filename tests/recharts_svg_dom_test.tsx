import React from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { PieChart, Pie, Cell } from 'recharts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root" style="width:500px;height:500px;"></div></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;

const mockData = [
  { name: 'Primary', value: 1200, color: '#3B82F6' },
  { name: 'Promotions', value: 3400, color: '#F59E0B' },
  { name: 'Updates', value: 800, color: '#10B981' },
];

const container = dom.window.document.getElementById('root')!;
const root = createRoot(container);

root.render(
  <div style={{ width: 500, height: 500 }}>
    <PieChart width={500} height={500}>
      <Pie
        data={mockData}
        cx={250}
        cy={250}
        innerRadius={65}
        outerRadius={100}
        paddingAngle={3}
        dataKey="value"
      >
        {mockData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Pie>
    </PieChart>
  </div>
);

setTimeout(() => {
  const svgEl = container.querySelector('svg');
  const pathEls = container.querySelectorAll('path');
  const surfaceEl = container.querySelector('.recharts-surface');

  console.log('SVG element present:', !!svgEl);
  console.log('Path element count:', pathEls.length);
  console.log('Recharts surface element present:', !!surfaceEl);

  if (svgEl && pathEls.length >= 3) {
    console.log('✓ Recharts genuinely generates SVG and Pie slice paths in DOM');
    process.exit(0);
  } else {
    console.error('✗ Recharts SVG DOM generation failed');
    process.exit(1);
  }
}, 500);
