import fs from 'fs';
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  '  if (isInitializing) {',
  `  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      setTimeout(() => setIsLoggingOut(false), 2000); // give it time to type Goodbye
    } catch (error) {
      console.error(error);
      setIsLoggingOut(false);
    }
  };

  if (isLoggingOut) {
    return <LogoutScreen />;
  }

  if (isInitializing) {`
);

content = content.replace('<Dashboard user={user} />', '<Dashboard user={user} onLogout={handleLogout} />');

fs.writeFileSync('src/App.tsx', content);
