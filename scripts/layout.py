"""Family-unit layout. Partnerships are separate edges, never one shared spouse bar."""
from collections import defaultdict

CARD_W, CARD_H, PERSON_GAP, BRANCH_GAP, ROW = 210, 100, 44, 64, 260


def arrange(data, focus_family):
    people = {p['id']: p for p in data['people']}
    families = {f['id']: f for f in data['families']}
    focus = families[focus_family]
    uf = {p: p for p in people}
    neighbours = defaultdict(set)

    def root(p):
        while uf[p] != p:
            p = uf[p]
        return p

    for f in families.values():
        if len(f['parents']) == 2:
            a, b = f['parents']
            uf[root(b)] = root(a)
            neighbours[a].add(b)
            neighbours[b].add(a)
    groups = defaultdict(list)
    for p in people:
        groups[root(p)].append(p)
    # Place the current partnership chains in a row so each pair is adjacent.
    # A future complex partnership graph needs a reviewed layout, not a guessed line.
    for g, members in list(groups.items()):
        if len(members) > 1:
            ends = sorted(p for p in members if len(neighbours[p]) == 1)
            if len(ends) != 2 or any(len(neighbours[p]) > 2 for p in members):
                raise ValueError('A complex partnership group needs a layout update before publication.')
            ordered = [ends[0]]
            while len(ordered) < len(members):
                ordered.append(next(p for p in neighbours[ordered[-1]] if p not in ordered))
            groups[g] = ordered

    outgoing, incoming = defaultdict(list), defaultdict(list)
    for f in families.values():
        if not f['parents']:
            raise ValueError('A family without any recorded parent needs review.')
        g = root(f['parents'][0])
        outgoing[g].append(f)
        for c in f['children']:
            incoming[root(c)].append(f)

    def anchor_offset(g, f):
        members = groups[g]
        return sum((members.index(p) - (len(members)-1)/2)*(CARD_W+PERSON_GAP)
                   for p in f['parents'])/len(f['parents'])

    for g in groups:
        outgoing[g].sort(key=lambda f: anchor_offset(g, f))
    widths, visiting = {}, set()

    def measure(g):
        if g in visiting:
            raise ValueError('A family loop needs review.')
        if g in widths:
            return widths[g]
        visiting.add(g)
        rows = []
        for f in outgoing[g]:
            if f['children']:
                gs = [root(p) for p in f['children']]
                if len(gs) != len(set(gs)):
                    raise ValueError('Related partners need an explicit layout before publication.')
                rows.append(sum(measure(c) for c in gs)+BRANCH_GAP*(len(gs)-1))
        own = len(groups[g])*(CARD_W+PERSON_GAP)-PERSON_GAP
        widths[g] = max(own, sum(rows)+BRANCH_GAP*max(0, len(rows)-1))
        visiting.remove(g)
        return widths[g]

    focus_g = root(focus['parents'][0])
    main_width = measure(focus_g)
    nodes, placed, paths, labels, branches = {}, set(), [], [], []
    group_centres = {}
    family_levels = {}

    def place_group(g, cx, y, colour=-1):
        if g in placed:
            raise ValueError('A shared branch needs a reviewed layout; no duplicate people will be drawn.')
        placed.add(g)
        group_centres[g] = (cx, y)
        for i, p in enumerate(groups[g]):
            nodes[p] = {'id': p, 'x': cx+(i-(len(groups[g])-1)/2)*(CARD_W+PERSON_GAP)-CARD_W/2,
                        'y': y, 'w': CARD_W, 'h': CARD_H, 'branch': colour}

    def place_tree(g, cx, y, colour=-1):
        place_group(g, cx, y, colour)
        fs = [f for f in outgoing[g] if f['children']]
        spans = [sum(measure(root(c)) for c in f['children'])+BRANCH_GAP*(len(f['children'])-1) for f in fs]
        left = cx-(sum(spans)+BRANCH_GAP*max(0, len(spans)-1))/2
        for f, span in zip(fs, spans):
            family_levels[f['id']] = y+ROW-64
            at = left
            for index, p in enumerate(f['children']):
                child = root(p)
                width = measure(child)
                next_colour = index if f['id'] == focus_family else colour
                place_tree(child, at+width/2, y+ROW, next_colour)
                if f['id'] == focus_family:
                    branches.append({'person': p, 'number': index+1, 'x': at, 'y': y+ROW-36,
                                     'width': width, 'colour': next_colour})
                at += width+BRANCH_GAP
            left += span+BRANCH_GAP

    # The shared couple sits once between its two sets of siblings.
    # Its descendants are laid out first, with both ancestral sides above it.
    place_tree(focus_g, main_width/2, ROW*2+64)
    ancestors_seen = set()

    def place_ancestors(person, side):
        child_node = nodes[person]
        for fid in people[person]['parentFamilies']:
            f = families[fid]
            g = root(f['parents'][0])
            if g in ancestors_seen:
                continue
            if g in placed:
                raise ValueError('Shared ancestry outside the focus pair needs a reviewed route.')
            ancestors_seen.add(g)
            siblings = [root(c) for c in f['children'] if root(c) != root(person)]
            # Earlier-generation collateral branches in this scan have no descendants.
            if any(any(x['children'] for x in outgoing[s]) for s in siblings):
                raise ValueError('An ancestral sibling now has descendants; extend the ancestor layout first.')
            cursor = min(n['x'] for n in nodes.values() if n['y'] == child_node['y'])-BRANCH_GAP if side < 0 else max(n['x']+CARD_W for n in nodes.values() if n['y'] == child_node['y'])+BRANCH_GAP
            for s in (list(reversed(siblings)) if side < 0 else siblings):
                width = len(groups[s])*(CARD_W+PERSON_GAP)-PERSON_GAP
                cx = cursor+side*width/2
                place_group(s, cx, child_node['y'])
                cursor += side*(width+BRANCH_GAP)
            targets = [nodes[c]['x']+CARD_W/2 for c in f['children']]
            cx = (min(targets)+max(targets))/2
            place_group(g, cx, child_node['y']-ROW)
            family_levels[fid] = child_node['y']-64
            for i, p in enumerate(groups[g]):
                place_ancestors(p, side if len(groups[g]) == 1 else (-1 if i == 0 else 1))

    for i, p in enumerate(focus['parents']):
        place_ancestors(p, -1 if i == 0 else 1)

    main_bottom = max(n['y']+CARD_H for n in nodes.values())
    remaining_roots = [g for g in groups if g not in placed and not incoming[g] and outgoing[g]]
    unknown_y = main_bottom+230
    if remaining_roots:
        total = sum(measure(g) for g in remaining_roots)+180*(len(remaining_roots)-1)
        at = main_width/2-total/2
        labels.append({'x': at, 'y': unknown_y-50, 'title': 'Connections to the main tree are not confirmed',
                       'text': 'These families are recorded in the scan. Their link to the main family is uncertain.'})
        for g in remaining_roots:
            place_tree(g, at+widths[g]/2, unknown_y)
            at += widths[g]+180
    isolated = [g for g in groups if g not in placed]
    if isolated:
        if any(outgoing[g] or incoming[g] for g in isolated):
            raise ValueError('Unplaced connected records need review.')
        y = max(n['y']+CARD_H for n in nodes.values())+190
        total = sum(len(groups[g])*(CARD_W+PERSON_GAP) for g in isolated)-PERSON_GAP
        at = main_width/2-total/2
        labels.append({'x': at, 'y': y-50, 'title': 'Other names in the scan',
                       'text': 'No confirmed family connection is recorded for these people.'})
        for g in isolated:
            width = len(groups[g])*(CARD_W+PERSON_GAP)-PERSON_GAP
            place_group(g, at+width/2, y)
            at += width+PERSON_GAP

    for f in families.values():
        ps = [nodes[p] for p in f['parents']]
        g = root(f['parents'][0])
        if len(ps) == 2:
            a, b = sorted(ps, key=lambda p: p['x'])
            if abs(b['x']-a['x']-(CARD_W+PERSON_GAP)) > .01 or a['y'] != b['y']:
                raise ValueError('Non-adjacent partnership needs a reviewed route.')
            anchor = [(a['x']+CARD_W+b['x'])/2, a['y']+CARD_H/2]
            paths.append({'family': f['id'], 'kind': 'partner',
                          'points': [[a['x']+CARD_W, anchor[1]], [b['x'], anchor[1]]]})
        else:
            anchor = [ps[0]['x']+CARD_W/2, ps[0]['y']+CARD_H]
        if f['children']:
            bus = family_levels[f['id']]
            xs = [nodes[c]['x']+CARD_W/2 for c in f['children']]
            paths.append({'family': f['id'], 'kind': 'parent', 'points': [anchor, [anchor[0], bus]]})
            paths.append({'family': f['id'], 'kind': 'children', 'points': [[min(xs+[anchor[0]]), bus], [max(xs+[anchor[0]]), bus]]})
            for c, x in zip(f['children'], xs):
                paths.append({'family': f['id'], 'kind': 'child', 'child': c,
                              'points': [[x, bus], [x, nodes[c]['y']]]})
            if len(ps) == 1:
                labels.append({'x': anchor[0]+9, 'y': anchor[1]+31, 'text': 'Only this parent is recorded', 'small': True})
    assert set(nodes) == set(people)
    left = min(n['x'] for n in nodes.values())-90
    top = min(n['y'] for n in nodes.values())-60
    right = max(n['x']+CARD_W for n in nodes.values())+90
    bottom = max(n['y']+CARD_H for n in nodes.values())+90
    return {'nodes': list(nodes.values()), 'paths': paths, 'labels': labels, 'branches': branches,
            'bounds': [left, top, right-left, bottom-top], 'cardWidth': CARD_W, 'cardHeight': CARD_H}
