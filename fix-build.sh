#!/bin/bash
echo "Clearing Next.js and module caches..."
rm -rf .next
rm -rf node_modules/.cache
rm -rf out
echo "Caches cleared. Attempting to build to verify project integrity..."
npm run build
echo "Build check complete. If successful, try downloading the zip workspace again."
