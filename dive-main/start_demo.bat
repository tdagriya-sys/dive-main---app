@echo off
echo Starting Dive Backend Server (Node/Express)...
start cmd /k "cd backend && npm run dev"

echo Starting Dive Frontend...
start cmd /k "cd frontend && npm start"

echo Dive is starting up! Two terminal windows have been opened for the frontend and backend.
