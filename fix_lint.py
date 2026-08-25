with open("src/components/FolderOptimizer.tsx", "r") as f:
    content = f.read()

content = content.replace('inspectingRec ? "min-h-[600px]" : ""', '""')

with open("src/components/FolderOptimizer.tsx", "w") as f:
    f.write(content)

with open("src/components/BulkOrganizeDropdown.tsx", "r") as f:
    content = f.read()

if "ChevronUp" not in content and "lucide-react" in content:
    content = content.replace("Archive, SlidersHorizontal } from 'lucide-react';", "Archive, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';")

with open("src/components/BulkOrganizeDropdown.tsx", "w") as f:
    f.write(content)
