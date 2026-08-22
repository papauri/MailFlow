import React from 'react';
import { renderToString } from 'react-dom/server';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

console.log('Testing direct Recharts rendering with renderToString...');

const mockData = [
  { id: 'primary', name: 'Primary', value: 100, color: '#3B82F6', displayCount: '100' },
  { id: 'promotions', name: 'Promotions', value: 200, color: '#F59E0B', displayCount: '200' },
  { id: 'updates', name: 'Updates', value: 50, color: '#10B981', displayCount: '50' },
  { id: 'social', name: 'Social', value: 10, color: '#8B5CF6', displayCount: '10' },
  { id: 'forums', name: 'Forums', value: 5, color: '#64748B', displayCount: '5' },
  { id: 'spam', name: 'Spam & Trash', value: 1, color: '#EF4444', displayCount: '1' },
];

try {
  const html = renderToString(
    <div style={{ width: 400, height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart width={400} height={300}>
          <Pie
            data={mockData}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
          >
            {mockData.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );

  console.log('Successfully rendered Recharts PieChart to string! Length:', html.length);
  console.log('HTML snippet:', html.substring(0, 200));
} catch (err) {
  console.error('Error rendering Recharts PieChart:', err);
}

// Test with 0 values
try {
  const zeroData = mockData.map(d => ({ ...d, value: 0 }));
  const zeroHtml = renderToString(
    <div style={{ width: 400, height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart width={400} height={300}>
          <Pie
            data={zeroData}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
          >
            {zeroData.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
  console.log('Successfully rendered Recharts PieChart with 0 values! Length:', zeroHtml.length);
} catch (err) {
  console.error('Error rendering Recharts PieChart with 0 values:', err);
}
