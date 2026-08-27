import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
process.env.DB_PATH = './data/payment-test.db';
process.env.STARTING_BALANCE = '0';
rmSync(process.env.DB_PATH, { force: true });
const { getOrCreateUser, getUserById, db } = await import('../server/db.js');
const payments = await import('../server/payments.js');

const a=getOrCreateUser({id:'pay-a',username:'a'}), b=getOrCreateUser({id:'pay-b',username:'b'});
const p1=payments.createPayment(a.id,1000,'sber'), p2=payments.createPayment(b.id,1000,'any');
assert.equal(p1.original_amount,1000); assert.notEqual(p1.payable_amount,p2.payable_amount);
payments.registerDevice('test-device','Test','a-very-long-test-device-secret');
const done=payments.processBeelineSms({amount:p1.payable_amount,message:`Чек билайна ${p1.payable_amount}.00 руб`,deviceId:'test-device'});
assert.equal(done.balance,1000); assert.equal(getUserById(a.id).balance,1000);
assert.equal(db.prepare('SELECT amount FROM balance_transactions WHERE payment_id=?').get(p1.id).amount,1000);
assert.throws(()=>payments.processBeelineSms({amount:p1.payable_amount,message:`Чек билайна ${p1.payable_amount}.00 руб`,deviceId:'test-device'}));
const chat=payments.openDispute(b.id,p2.id); assert.ok(chat.id); assert.equal(payments.supportChat(chat.id).messages.length,1);
db.close(); rmSync(process.env.DB_PATH,{force:true});
console.log('Payment tests passed');
