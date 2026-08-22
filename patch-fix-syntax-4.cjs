const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  `          </div>
          </>
        )}
      </main>`,
  `          </div>
        </div>
        </>
        )}
      </main>`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
