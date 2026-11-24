import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from layout import arrange
from check_layout import check_layout


def fixture():
    fs=[{'id':'pair','parents':['a','b'],'children':['c','d']},
        {'id':'earlier','parents':['e','f'],'children':['a','g']},
        {'id':'other','parents':['h','i'],'children':['b','j']},
        {'id':'partnership','parents':['c','k'],'children':['l']},
        {'id':'single','parents':['c'],'children':['m']},
        {'id':'separate','parents':['n','o'],'children':['p']}]
    ps=[{'id':p,'name':'Synthetic '+p,'families':[f['id'] for f in fs if p in f['parents']],
         'parentFamilies':[f['id'] for f in fs if p in f['children']]} for p in 'abcdefghijklmnopq']
    return {'people':ps,'families':fs}


class LayoutTests(unittest.TestCase):
    def test_shared_ancestry_single_parent_and_unplaced_records(self):
        d=fixture();d['layout']=arrange(d,'pair');result=check_layout(d)
        self.assertEqual(result['cards'],17)
        self.assertEqual(len({n['id'] for n in d['layout']['nodes']}),17)
        self.assertEqual([b['person'] for b in d['layout']['branches']],['c','d'])
        self.assertEqual(result['unrelatedCrossings'],0)
        self.assertTrue(any('not confirmed' in l.get('title','') for l in d['layout']['labels']))
        self.assertEqual([p['child'] for p in d['layout']['paths'] if p['family']=='single' and p['kind']=='child'],['m'])

    def test_geometry_check_detects_accidental_overlap(self):
        d=fixture();d['layout']=arrange(d,'pair');a,b=d['layout']['nodes'][:2]
        b['x']=a['x'];b['y']=a['y']
        with self.assertRaisesRegex(ValueError,'Cards overlap'):check_layout(d)

    def test_complex_family_connections_fail_instead_of_duplicating_people(self):
        d=fixture();d['families'].append({'id':'extra','parents':['c','q'],'children':[]})
        d['families'].append({'id':'cycle','parents':['k','q'],'children':[]})
        with self.assertRaisesRegex(ValueError,'complex partnership'):arrange(d,'pair')


if __name__=='__main__':unittest.main()
