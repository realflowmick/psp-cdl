// SPDX-License-Identifier: Apache-2.0
import {runMediationCase} from '../../scripts/mediation-fixtures.mjs';
console.log(await runMediationCase({id:'permitted'}));
console.log(await runMediationCase({id:'denied',settings:{policyDeny:true}}));
