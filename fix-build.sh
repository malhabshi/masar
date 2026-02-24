#!/bin/bash
echo "Clearing Next.js and module caches..."
rm -rf .next
rm -rf node_modules/.cache
echo "Caches cleared. Please restart the dev server with 'npm run dev'."
