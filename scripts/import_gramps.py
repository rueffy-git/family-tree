"""Read a private Gramps XML export. Output JSON to stdout, never to the public site."""
import argparse
import gzip
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'g': 'http://gramps-project.org/xml/1.7.2/'}


def load(source):
    raw = Path(source).read_bytes()
    xml = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    root = ET.fromstring(xml)
    if root.tag != '{' + NS['g'] + '}database':
        raise ValueError('A Gramps XML 1.7.2 export is required.')
    sections = {'people': 'person', 'families': 'family', 'events': 'event',
                'notes': 'note', 'citations': 'citation', 'sources': 'source', 'tags': 'tag'}
    records = {key: root.findall(f'g:{key}/g:{tag}', NS) for key, tag in sections.items()}
    ids = {e.get('handle'): e.get('id', e.get('name', '')) for group in records.values() for e in group}

    def text(e, tag):
        return e.findtext('g:' + tag, '', NS)

    def refs(e, tag):
        return [ids[x.get('hlink')] for x in e.findall('g:' + tag, NS)]

    def ref(e, tag):
        found = refs(e, tag)
        return found[0] if found else None

    def date(e):
        for tag in ['dateval', 'daterange', 'datespan', 'datestr']:
            item = e.find('g:' + tag, NS)
            if item is not None:
                return {'kind': tag, **item.attrib}
        return None

    def common(e):
        return {'id': e.get('id'), 'notes': refs(e, 'noteref'), 'citations': refs(e, 'citationref')}

    def name(e):
        return ' '.join(s for s in [text(e, 'title'), text(e, 'first'),
                        ' '.join(' '.join(filter(None, [s.get('prefix'), s.text, s.get('connector')]))
                                 for s in e.findall('g:surname', NS)), text(e, 'suffix')] if s).strip()

    # Reject unsupported record fields instead of silently dropping new information.
    supported = {
        'people': {'gender', 'name', 'parentin', 'childof', 'eventref', 'noteref', 'citationref', 'tagref'},
        'families': {'rel', 'father', 'mother', 'eventref', 'childref', 'noteref', 'citationref'},
        'events': {'type', 'dateval', 'daterange', 'datespan', 'datestr', 'description', 'noteref', 'citationref'},
        'notes': {'text', 'style'},
        'sources': {'stitle', 'sauthor', 'spubinfo', 'sabbrev', 'noteref', 'objref'},
        'citations': {'page', 'confidence', 'sourceref', 'noteref', 'dateval', 'datestr', 'daterange', 'datespan'},
    }
    for section, allowed in supported.items():
        for e in records[section]:
            unknown = {c.tag.split('}')[-1] for c in e} - allowed
            if unknown:
                raise ValueError(f'Extend the importer before publishing: unsupported {section} fields {sorted(unknown)}')

    people = []
    for p in records['people']:
        names = p.findall('g:name', NS)
        people.append({**common(p), 'name': name(names[0]),
                       'otherNames': [name(n) for n in names[1:]], 'gender': text(p, 'gender'),
                       'events': refs(p, 'eventref'), 'families': refs(p, 'parentin'),
                       'parentFamilies': refs(p, 'childof'), 'tags': refs(p, 'tagref')})
    families = []
    for f in records['families']:
        relation = f.find('g:rel', NS)
        families.append({**common(f), 'parents': [v for v in [ref(f, 'father'), ref(f, 'mother')] if v],
                         'children': refs(f, 'childref'), 'events': refs(f, 'eventref'),
                         'relationship': relation.get('type', '') if relation is not None else '',
                         'childRelations': [{**c.attrib, 'id': ids[c.get('hlink')]} for c in f.findall('g:childref', NS)]})
        for c in families[-1]['childRelations']:
            c.pop('hlink', None)
    data = {
        'version': 1,
        'people': people, 'families': families,
        'events': [{**common(e), 'type': text(e, 'type'), 'date': date(e), 'description': text(e, 'description')}
                   for e in records['events']],
        'notes': [{'id': e.get('id'), 'type': e.get('type', ''), 'text': text(e, 'text')}
                  for e in records['notes']],
        'citations': [{**common(e), 'page': text(e, 'page'), 'confidence': text(e, 'confidence'),
                       'source': ref(e, 'sourceref'), 'date': date(e)} for e in records['citations']],
        'sources': [{**common(e), 'title': text(e, 'stitle'), 'author': text(e, 'sauthor'),
                     'publication': text(e, 'spubinfo'), 'abbreviation': text(e, 'sabbrev'),
                     'hasLocalScan': e.find('g:objref', NS) is not None} for e in records['sources']],
        'sourceHash': hashlib.sha256(raw).hexdigest(),
    }
    by_person = {p['id']: p for p in people}
    for f in families:
        for p in f['parents']:
            assert f['id'] in by_person[p]['families'], 'Parent family reference does not match'
        for c in f['children']:
            assert f['id'] in by_person[c]['parentFamilies'], 'Child family reference does not match'
    assert len(by_person) == len(people), 'Duplicate person IDs'
    data['counts'] = {k: len(data[k]) for k in sections if k in data}
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    from layout import arrange
    from check_layout import check_layout
    data = load(args.source)
    config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    data['updated'] = config['updated']
    data['layout'] = arrange(data, config['focusFamily'])
    check_layout(data)
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
