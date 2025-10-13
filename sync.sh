#!/bin/bash

# n8n Workflow Sync Script
# This script watches for changes in the Generation Methods folder and syncs with n8n

cd "$(dirname "$0")"

echo "🚀 n8n Workflow Sync Watcher"
echo ""
echo "Watching: ../../Generation Methods"
echo "Press Ctrl+C to stop"
echo ""

# Run the watcher
npm start

