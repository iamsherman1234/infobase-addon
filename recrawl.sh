#!/bin/bash
cd /root/infobase-addon
rm -f cache.json
node -e "const {crawl} = require('./crawler'); crawl().then(m => { console.log('Recrawl done:', m.length, 'movies'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })" >> /var/log/infobase-recrawl.log 2>&1
