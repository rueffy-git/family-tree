"""Reject overlapping cards, lines through cards, and unrelated connector crossings."""
import itertools


def check_layout(data):
    layout = data['layout']
    nodes = layout['nodes']
    issues = []
    for a, b in itertools.combinations(nodes, 2):
        if max(a['x'], b['x']) < min(a['x']+a['w'], b['x']+b['w'])-.01 and max(a['y'], b['y']) < min(a['y']+a['h'], b['y']+b['h'])-.01:
            issues.append(f"Cards overlap: {a['id']}, {b['id']}")
    segments = []
    for edge in layout['paths']:
        for start, end in zip(edge['points'], edge['points'][1:]):
            x1,x2=sorted([start[0],end[0]]);y1,y2=sorted([start[1],end[1]])
            if x1==x2 and y1==y2:
                continue
            if x1!=x2 and y1!=y2:
                issues.append('A connector is not orthogonal.')
            seg = (x1,y1,x2,y2,edge['family'])
            segments.append(seg)
            for n in nodes:
                if x1==x2 and n['x']+.01<x1<n['x']+n['w']-.01 and max(y1,n['y'])<min(y2,n['y']+n['h'])-.01:
                    issues.append(f"Line through card: {edge['family']}, {n['id']}")
                if y1==y2 and n['y']+.01<y1<n['y']+n['h']-.01 and max(x1,n['x'])<min(x2,n['x']+n['w'])-.01:
                    issues.append(f"Line through card: {edge['family']}, {n['id']}")
    for a,b in itertools.combinations(segments,2):
        if a[4]==b[4]:
            continue
        av=a[0]==a[2];bv=b[0]==b[2]
        if av!=bv:
            v,h=(a,b) if av else (b,a)
            if h[0]-.01<=v[0]<=h[2]+.01 and v[1]-.01<=h[1]<=v[3]+.01:
                issues.append(f'Unrelated lines cross: {a[4]}, {b[4]}')
        elif av and a[0]==b[0] and max(a[1],b[1])<min(a[3],b[3])-.01:
            issues.append(f'Unrelated vertical lines overlap: {a[4]}, {b[4]}')
        elif not av and a[1]==b[1] and max(a[0],b[0])<min(a[2],b[2])-.01:
            issues.append(f'Unrelated horizontal lines overlap: {a[4]}, {b[4]}')
    if issues:
        raise ValueError('\n'.join(sorted(set(issues))))
    return {'cards':len(nodes),'connectors':len(layout['paths']),'overlaps':0,'linesThroughCards':0,'unrelatedCrossings':0}
