#!/usr/bin/env python3
"""Reconcile archived swaps against AMM reserves, then replay same inputs without 0.3% fee.
Read-only offline accounting. No RPC, private keys, or contract interaction.
"""
import json
from decimal import Decimal, getcontext
from pathlib import Path
getcontext().prec = 65
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'evidence/simulation/20-users-sustained-60s-passed.json'
r=json.loads(source.read_text(encoding='utf-8-sig'))
transactions=r['transactions']
swaps=[x for x in transactions if x['action']=='swaps']
assert len(swaps)==r['swapCount']
ra=int(r['initialPool']['reserveA']);rb=int(r['initialPool']['reserveB'])
na=ra;nb=rb
replay=[]
for tx in swaps:
    amount=int(tx['amountIn'])
    direction=tx['direction']
    assert amount>0
    if direction=='TKA->TKB':
        out=amount*997*rb//(ra*1000+amount*997)
        nofee_out=amount*nb//(na+amount)
        ra+=amount;rb-=out;na+=amount;nb-=nofee_out
    elif direction=='TKB->TKA':
        out=amount*997*ra//(rb*1000+amount*997)
        nofee_out=amount*na//(nb+amount)
        rb+=amount;ra-=out;nb+=amount;na-=nofee_out
    else:
        raise AssertionError('Unexpected swap direction '+str(direction))
    assert out>=int(tx['minOut']), 'quote would violate logged minOut'
    replay.append((tx['sequence'],direction,amount,out))
assert ra==int(r['poolBeforeRemove']['reserveA']),(ra,r['poolBeforeRemove']['reserveA'])
assert rb==int(r['poolBeforeRemove']['reserveB']),(rb,r['poolBeforeRemove']['reserveB'])
assert len({tx['hash'] for tx in transactions})==len(transactions)
assert len(r['lpAccounting']['perUser'])==20
assert sum(int(lp['withdrawnA']) for lp in r['lpAccounting']['perUser'])==ra
assert sum(int(lp['withdrawnB']) for lp in r['lpAccounting']['perUser'])==rb
W=Decimal(10)**18
f=lambda x: str(Decimal(x)/W)
# Price is final pool's marginal B per A. Not an independent market reference.
priceBperA=Decimal(rb)/Decimal(ra)
assetValueTKA=Decimal(ra)/W +(Decimal(rb)/W)/priceBperA
nofeeAssetValueTKA=Decimal(na)/W +(Decimal(nb)/W)/priceBperA
hodlValueTKA=Decimal(200) + Decimal(200)/priceBperA
feeModelUplift=assetValueTKA-nofeeAssetValueTKA
out={
 'method':'replay every logged swap, then compare identical inputs/order with fee=0 counterfactual',
 'referencePrice':'final actual pool marginal price B per A, a modeling convention not oracle/market price',
 'reconciliation':'PASS: integer-fee replay equals archived pre-withdraw reserves',
 'swapCount':len(swaps),
 'initial': {'A':'200','B':'200'},
 'actualAfterSwaps':{'TKA':f(ra),'TKB':f(rb)},
 'zeroFeeCounterfactual':{'TKA':f(na),'TKB':f(nb)},
 'feeInputs':{'TKA':r['feeA']['humanUnits'],'TKB':r['feeB']['humanUnits']},
 'valuationInTKAAtActualFinalPoolPrice':{
   'priceBPerA':str(priceBperA),
   'actualLPValueTKA':str(assetValueTKA),
   'zeroFeeCounterfactualLPValueTKA':str(nofeeAssetValueTKA),
   'sameSwapsFeeModelUpliftTKA':str(feeModelUplift),
   'HODL200A200BValueTKA':str(hodlValueTKA),
   'LPMinusHODLValueTKA':str(assetValueTKA-hodlValueTKA)
 },
 'limitations':[
  'Counterfactual assumes identical order/amount of swaps even though fee differences could change user behavior.',
  'End-point pool spot price is not an external oracle and cannot support fiat-denominated PnL.',
  '0.3% input fee estimates are not tokens independently paid out to each LP.',
  'Single-token valuation depends on price convention and does not independently quantify pure impermanent loss.',
  'Per-user LP value requires share accounting; archived perUser withdrawals reflect balance changes, not fee-specific transfers.'
 ]
}
output=ROOT/'docs/LP手续费_反事实对照分析.json'
output.write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
print('PASS: 554 swaps replayed using 997/1000; pre-withdraw reserves matched')
print('Actual A/B:',f(ra),f(rb),'No-fee A/B:',f(na),f(nb))
print('Fee uplift (model TKA value):',feeModelUplift)
print('Wrote',output)
