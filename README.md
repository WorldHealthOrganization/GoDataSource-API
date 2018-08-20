# Go.Data v2.0 API

## Deployment Instructions (for development)

When deploying a new instance there is a minimum number of steps that need to be performed:
1. change database details in server/datasources.json
2. change port in server/config.json
3. change public.host & public.port in server/config.json - these are the settings used for building password reset link in password reset email; they need to point to the WEB UI host and port
4. `# npm install`
5. `# npm run init-database`
6. `# npm start`
