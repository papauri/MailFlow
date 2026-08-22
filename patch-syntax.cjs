const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  `                <div className="flex flex-col gap-4 pb-4">
                  {groupedEmails.map((group, groupIdx) => (`,
  `                <>
                  <div className="flex flex-col gap-4 pb-4">
                    {groupedEmails.map((group, groupIdx) => (`
);

code = code.replace(
  `                  })}
                      </ul>
                    </div>
                  ))}
                </div>
              </>`,
  `                  })}
                      </ul>
                    </div>
                  ))}
                </div>`
); // Note: I removed the </>, wait, the old replacement added </>. Did it?

fs.writeFileSync('src/components/Dashboard.tsx', code);
