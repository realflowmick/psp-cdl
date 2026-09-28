# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
import json
from pathlib import Path
import unittest
from psp_cdl_core import PspError, compile_application, parse_markup, serialize_markup
CASES=json.loads((Path(__file__).resolve().parents[3]/'conformance/vectors/graphs/profile-0.1.json').read_text(encoding='utf-8'))['cases']
class GraphTest(unittest.TestCase):
    def test_shared_vectors(self):
        for c in CASES:
            with self.subTest(case=c['id']):
                def run():
                    g=compile_application(c['request']);result={'description':g.describe()}
                    if 'select' in c:result['selection']=g.select(*c['select'])
                    return result
                if 'error' in c['expected']:
                    with self.assertRaises(PspError) as caught:run()
                    self.assertEqual(caught.exception.code,c['expected']['error'])
                else:self.assertEqual(run(),c['expected']['result'])
    def test_detached_authority_and_markup_roundtrip(self):
        q=deepcopy(CASES[0]['request']);before=deepcopy(q)
        q['document']=parse_markup(serialize_markup(q['document']))
        g=compile_application(q);d=g.describe()
        self.assertEqual(d,CASES[0]['expected']['result']['description'])
        q['document']['children'].clear();d['nodes'][1]['transitions'].clear()
        self.assertEqual(g.select('/left',True,{}),CASES[0]['expected']['result']['selection'])
        self.assertEqual(g.describe(),CASES[0]['expected']['result']['description'])
        self.assertEqual(CASES[0]['request'],before)
    def test_count_and_depth_bounds(self):
        q=deepcopy(CASES[0]['request']);r=q['document']['children'][0]
        leaf=deepcopy(r['children'][1]);r['children']=[]
        for i in range(1024):
            n=deepcopy(leaf);n['attributes']['id']='n'+str(i);r['children'].append(n)
        with self.assertRaises(PspError) as caught:compile_application(q)
        self.assertEqual(caught.exception.code,'GRAPH_LIMIT_EXCEEDED')
        r['children']=[leaf];n=leaf
        for i in range(32):
            n['attributes']['node-type']='composite';n['children']=[deepcopy(leaf)] if i==0 else [{'kind':'section','attributes':{'type':'node','node-type':'prompt','id':'inner','version':'1.0.0'},'children':[]}]
            n=n['children'][0]
        with self.assertRaises(PspError) as caught:compile_application(q)
        self.assertEqual(caught.exception.code,'GRAPH_LIMIT_EXCEEDED')
