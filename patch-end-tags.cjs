const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  `                  })}
                </ul>
                {nextPageToken && (`,
  `                  })}
                      </ul>
                    </div>
                  ))}
                </div>
                {nextPageToken && (`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
