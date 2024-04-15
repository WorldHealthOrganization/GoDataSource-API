# Go.Data v2.0 API

This project was built using Loopback 3.x using Node 14.17.5 and MongoDb 5.0.x.

## Installation (Development Environment)

### Pre-requisites
Install latest Node 14.17.5 (https://nodejs.org/dist) and MongoDB 5.0.x (https://www.mongodb.com/download-center/community).

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

# Terms of Use

Please read these Terms of Use and Software License Agreement (the “**Agreement**”) carefully before installing the Go.Data Software (the “**Software**”).

By installing and/or using the Software, you (the “**Licensee**”) accept all terms, conditions, and requirements of the Agreement. 

## 1. Components of the Software

The Software is a product published by WHO (the “**Software**”) and enables you to input, upload and view your data (the “**Data**”). 

This Agreement governs your use of the Software you have downloaded.


## 2. Third-party software

#### 2.1. Third-party software embedded in the Software.

The Software contains third party open source software components, issued under various open source licenses:

- 0BSD
- AFL-2.1
- BSD-3-Clause
- BSD-2-Clause
- BSD-3-Clause-Clear
- Apache-2.0
- MIT
- MIT-0
- MPL-2.0
- CC-BY-3.0
- CC-BY-4.0
- CC0-1.0
- ISC
- Unlicense
- WTFPL
- AGPL-3.0
- Python-2.0
- BlueOak-1.0.0
- Artistic-2.0
- Zlib
- Ruby

The text of the respective licenses can be found in Annex 2.

#### 2.2. WHO disclaimers for third-party software.

WHO makes no warranties whatsoever, and specifically disclaims any and all warranties, express or implied, that either of the third-party components are free of defects, virus free, able to operate on an uninterrupted basis, merchantable, fit for a particular purpose, accurate, non-infringing or appropriate for your technical system.

#### 2.3. No WHO endorsement of third-party software.

The use of the third-party Components or other third-party software does not imply that these products are endorsed or recommended by WHO in preference to others of a similar nature.

## 3. License and Terms of Use for the Software 

#### Copyright and license. 

The Software is copyright (©) World Health Organization, 2018, and is distributed under the terms of the GNU General Public License version 3 (GPL-3.0). The full license text of the GNU GPL-3.0 can be found below in Annex 1.

## 4. Copyright, Disclaimer and Terms of Use for the Maps 

#### 4.1. 

The boundaries and names shown and the designations used on the maps [embedded in the Software] (the “**Maps**”) do not imply the expression of any opinion whatsoever on the part of WHO concerning the legal status of any country, territory, city or area or of its authorities, or concerning the delimitation of its frontiers or boundaries. Dotted and dashed lines on maps represent approximate border lines for which there may not yet be full agreement. 

#### 4.2. 

Unlike the Software, WHO is not publishing the Maps under the terms of the GNU GPL-3.0. The Maps are not based on “R”, they are an independent and separate work from the Software, and not intended to be distributed as “part of a whole” with the Software.

## 5. Acknowledgment and Use of WHO Name and Emblem

You shall not state or imply that results from the Software are WHO’s products, opinion, or statements. Further, you shall not (i) in connection with your use of the Software, state or imply that WHO endorses or is affiliated with you or your use of the Software, the Software, the Maps, or that WHO endorses any entity, organization, company, or product, or (ii) use the name or emblem of WHO in any way. All requests to use the WHO name and/or emblem require advance written approval of WHO.

## 6. Dispute Resolution

Any matter relating to the interpretation or application of this Agreement which is not covered by its terms shall be resolved by reference to Swiss law. Any dispute relating to the interpretation or application of this Agreement shall, unless amicably settled, be subject to conciliation. In the event of failure of the latter, the dispute shall be settled by arbitration. The arbitration shall be conducted in accordance with the modalities to be agreed upon by the parties or, in the absence of agreement, in accordance with the UNCITRAL Arbitration Rules. The parties shall accept the arbitral award as final.

## 7. Privileges and Immunities of WHO

Nothing contained herein or in any license or terms of use related to the subject matter herein (including, without limitation, the GNU General Public License version 3 mentioned in paragraph 3.1 above) shall be construed as a waiver of any of the privileges and immunities enjoyed by the World Health Organization under national or international law, and/or as submitting the World Health Organization to any national jurisdiction.

Annex 1

- [GNU General Public License Version 3, 29 June 2007](LICENSE)

Annex 2

- [0BSD](https://opensource.org/license/0bsd)
- [AFL-2.1](https://spdx.org/licenses/AFL-2.1.html)
- [BSD-3-Clause](https://opensource.org/license/bsd-3-clause)
- [BSD-2-Clause](https://opensource.org/license/bsd-2-clause)
- [BSD-3-Clause-Clear](https://spdx.org/licenses/BSD-3-Clause-Clear.html)
- [Apache-2.0](https://opensource.org/license/apache-2-0)
- [MIT](https://opensource.org/license/mit)
- [MIT-0](https://opensource.org/license/mit-0)
- [MPL-2.0](https://opensource.org/license/mpl-2-0)
- [CC-BY-3.0](https://creativecommons.org/licenses/by/3.0/legalcode.en)
- [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en)
- [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en)
- [ISC](https://opensource.org/license/isc-license-txt)
- [Unlicense](https://opensource.org/license/unlicense)
- [WTFPL](http://www.wtfpl.net/about/)
- [AGPL-3.0](https://opensource.org/license/agpl-v3)
- [Python-2.0](https://www.python.org/download/releases/2.0/)
- [BlueOak-1.0.0](https://opensource.org/license/blue-oak-model-license)
- [Artistic-2.0](https://opensource.org/license/artistic-2-0)
- [Zlib](https://opensource.org/license/zlib)
- [Ruby](https://spdx.org/licenses/Ruby.html)