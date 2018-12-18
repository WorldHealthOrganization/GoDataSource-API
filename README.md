# Go.Data v2.0 API

This project was built using Loopback 3.x using Node 8.x (latest LTS at the time of the development) and MongoDb 3.2.

## Installation (Development Environment)

### Pre-requisites
Install latest Node 8.x (https://nodejs.org/dist) and MongoDB 3.2 (https://www.mongodb.com/download-center/community).

We used MongoDB 3.2 because the product was required to run on Windows 32bit and MongoDB version 3.2 was the latest
version to support 32bit OSes.

### Installation steps

1. Clone this repository form GIT
2. Install 3rd-party packages `# npm install`
3. Configure database settings in server/datasources.json
4. Configure server settings in server/config.json
5. Initialize database (create collections, indexes and default data) `# npm run init-database`
6. Start server `# npm start`

By default the server will start listening on port 3000 (this is configurable in server/config.json)

## Deployment Instructions (for development)

When deploying a new instance there is a minimum number of steps that need to be performed:
1. change database details in server/datasources.json
2. change port in server/config.json
3. change public.host & public.port in server/config.json - these are the settings used for building password reset link in password reset email; they need to point to the WEB UI host and port
4. `# npm install`
5. `# npm run init-database` or `# npm run migrate-database` - if its an existing database that needs migration
6. `# npm start`
