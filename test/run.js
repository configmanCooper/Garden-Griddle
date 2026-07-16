'use strict';

require('./core.test.js');
require('./balance.test.js').runBalanceTests();
require('./progression.test.js');
require('./android-config.test.js');
require('child_process').execFileSync(process.execPath, [require.resolve('./server.test.js')], { stdio: 'inherit' });
console.log('all tests passed');
