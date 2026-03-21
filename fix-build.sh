#!/bin/bash
echo "🚀 Starting aggressive cleanup to resolve build and workspace download issues..."

# Remove Next.js build artifacts
if [ -d ".next" ]; then
  echo "🗑️ Removing .next folder..."
  rm -rf .next
fi

# Remove standard build outputs
if [ -d "out" ]; then
  echo "🗑️ Removing out folder..."
  rm -rf out
fi

# Remove cache folders
if [ -d "node_modules/.cache" ]; then
  echo "🗑️ Removing node_modules/.cache..."
  rm -rf node_modules/.cache
fi

# Remove any existing zip files that might be lingering
rm -f workspace.zip

echo "✨ Cleanup complete. You can now try downloading the ZIP workspace again."
echo "💡 Note: Avoiding a full 'npm run build' before downloading can keep the workspace size small."
