// SPDX-License-Identifier: Apache-2.0
import {createCipheriv} from 'node:crypto';
import {signEnvelope} from '@psp-cdl/core/crypto';
import {envelopeToSection,serializeMarkup} from '@psp-cdl/core';
import {suite} from './security-tools-fixtures.mjs';
const nonce=Buffer.alloc(12);nonce[11]=99;
const cipher=createCipheriv('aes-256-gcm',Buffer.from(suite.encryptionKeyHex,'hex'),nonce,{authTagLength:16});
const sealed=Buffer.concat([cipher.update(Buffer.from('NODE SYNTHETIC 🧪')),cipher.final()]);
const e=signEnvelope(sealed.toString('base64'),{algorithm:'hmac-sha256',secretId:'test-sign',signatureVersion:'2.0',timestamp:900,expires:1800,version:'1.0.0',sectionType:'context',contentType:'text',attributes:{'tenant-id':'tenant-a','operation-id':'op-1','policy-version':'policy-1',encrypted:'true','encryption-algorithm':'aes-256-gcm','encryption-key-id':'test-aes',nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64')}},Buffer.from(suite.signingKeyHex,'hex'));
console.log(serializeMarkup({kind:'document',children:[envelopeToSection(e)]}));
