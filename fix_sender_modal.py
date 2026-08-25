import re

with open("src/components/InboxHealth.tsx", "r") as f:
    content = f.read()

# Add emails={recentEmailsState} to SenderAnalyticsModal
content = content.replace("<SenderAnalyticsModal \n        isOpen={isSenderAnalyticsOpen}", "<SenderAnalyticsModal \n        isOpen={isSenderAnalyticsOpen}\n        emails={recentEmailsState}")

with open("src/components/InboxHealth.tsx", "w") as f:
    f.write(content)
