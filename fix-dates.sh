#!/bin/bash

echo "Fixing date handling in all components..."

# Find all files that might use dates
find src -name "*.tsx" -o -name "*.ts" | while read file; do
  # Skip if it's already using our utils
  if grep -q "timestamp-utils" "$file"; then
    continue
  fi
  
  # Check if file uses new Date() with a variable
  if grep -q "new Date(" "$file"; then
    echo "Need to check: $file"
    # Add import if not present
    if ! grep -q "import.*timestamp-utils" "$file"; then
      sed -i '1i import { formatDate, formatRelativeTime } from "@/lib/timestamp-utils";' "$file"
    fi
  fi
done

echo "Done. Please review changes and rebuild."
