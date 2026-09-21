import json, urllib.parse, urllib.request, xml.etree.ElementTree as ET, re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'/'papers.json'
START_YEAR=2023
TZ=timezone(timedelta(hours=8))

KEYWORDS=[
 '"Google AI Overviews"',
 '"AI Overviews" Google search',
 '"Search Generative Experience" Google',
 'generative search Google health',
 'AI search citation Google',
 'AI search health Google'
]

LEVEL_RULES={
 'Query':['query','activation','trigger','question form','search term'],
 'Content':['claim','fidelity','accuracy','relevance','sentiment','stance','uncertainty','safeguard'],
 'Citation':['citation','source','provenance','publisher','domain'],
 'Presentation':['click','traffic','zero-click','interface','snippet','user behavior','exposure']
}

def get_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'AIO-Research-Watch/1.0 (academic literature monitor)'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))

def get_text(url):
    req=urllib.request.Request(url,headers={'User-Agent':'AIO-Research-Watch/1.0 (academic literature monitor)'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.read().decode('utf-8','ignore')

def norm(s): return re.sub(r'\s+',' ',(s or '')).strip()
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')[:90]
def classify(text):
    t=text.lower(); out=[]
    for level,words in LEVEL_RULES.items():
        if any(w in t for w in words): out.append(level)
    return out or ['Content']

def relevant(title,abstract):
    t=(title+' '+abstract).lower()
    must = ('google' in t and ('ai overview' in t or 'search generative experience' in t or 'generative search' in t or 'ai search' in t))
    return must

def scan_openalex():
    found=[]
    for q in KEYWORDS:
        params={
            'search':q.replace('"',''),
            'filter':f'from_publication_date:{START_YEAR}-01-01',
            'sort':'publication_date:desc',
            'per-page':'50'
        }
        url='https://api.openalex.org/works?'+urllib.parse.urlencode(params)
        try: data=get_json(url)
        except Exception: continue
        for w in data.get('results',[]):
            title=norm(w.get('display_name',''))
            inv=w.get('abstract_inverted_index') or {}
            if inv:
                pairs=[]
                for word,poss in inv.items():
                    for p in poss: pairs.append((p,word))
                abstract=' '.join(word for _,word in sorted(pairs))
            else: abstract=''
            if not relevant(title,abstract): continue
            year=w.get('publication_year') or 0
            if year<START_YEAR: continue
            authors=[a.get('author',{}).get('display_name','') for a in w.get('authorships',[]) if a.get('author')]
            loc=w.get('primary_location') or {}
            src=(loc.get('source') or {}).get('display_name') or 'OpenAlex indexed work'
            doi=(w.get('doi') or '').replace('https://doi.org/','')
            oa=w.get('open_access') or {}
            best=w.get('best_oa_location') or {}
            pdf=best.get('pdf_url') or ''
            record=w.get('doi') or w.get('id') or ''
            date=w.get('publication_date') or f'{year}-01-01'
            ident='doi-'+doi.lower() if doi else 'openalex-'+(w.get('id','').split('/')[-1] or slug(title))
            found.append({
                'id':ident,'title':title,'authors':authors,'date':date,'venue':src,
                'type':w.get('type','article').replace('_',' ').title(),'doi':doi,'record':record,'pdf':pdf,
                'abstract':norm(abstract),'levels':classify(title+' '+abstract),'topics':[],
                'source':'OpenAlex','first_detected':datetime.now(TZ).date().isoformat()
            })
    return found

def scan_arxiv():
    found=[]
    query=' OR '.join(['all:"Google AI Overviews"','all:"AI Overviews"','all:"Search Generative Experience"'])
    url='https://export.arxiv.org/api/query?'+urllib.parse.urlencode({'search_query':query,'start':0,'max_results':100,'sortBy':'submittedDate','sortOrder':'descending'})
    try: xml=get_text(url)
    except Exception: return found
    ns={'a':'http://www.w3.org/2005/Atom'}
    root=ET.fromstring(xml)
    for e in root.findall('a:entry',ns):
        title=norm(e.findtext('a:title','',ns)); abstract=norm(e.findtext('a:summary','',ns))
        if not relevant(title,abstract): continue
        published=e.findtext('a:published','',ns)[:10]
        try: year=int(published[:4])
        except: year=0
        if year<START_YEAR: continue
        authors=[norm(a.findtext('a:name','',ns)) for a in e.findall('a:author',ns)]
        rid=e.findtext('a:id','',ns); arx=rid.rstrip('/').split('/')[-1]
        found.append({'id':'arxiv-'+arx,'title':title,'authors':authors,'date':published,'venue':'arXiv','type':'Preprint','doi':'','record':rid,'pdf':'https://arxiv.org/pdf/'+arx,'abstract':abstract,'levels':classify(title+' '+abstract),'topics':[],'source':'arXiv','first_detected':datetime.now(TZ).date().isoformat()})
    return found

def merge():
    existing=json.loads(DATA.read_text()) if DATA.exists() else {'papers':[]}
    old={p['id']:p for p in existing.get('papers',[])}
    title_map={slug(p.get('title','')):p['id'] for p in old.values()}
    candidates=scan_arxiv()+scan_openalex()
    added=0
    for p in candidates:
        key=p['id']; ts=slug(p['title'])
        if key in old:
            keep=old[key]; keep.update({k:v for k,v in p.items() if v not in ('',[],None)})
        elif ts in title_map:
            keep=old[title_map[ts]]; keep.update({k:v for k,v in p.items() if v not in ('',[],None)})
        else:
            old[key]=p; title_map[ts]=key; added+=1
    papers=sorted(old.values(),key=lambda x:x.get('date',''),reverse=True)
    now=datetime.now(TZ).isoformat(timespec='seconds')
    out={'last_updated':now,'new_in_latest_scan':added,'papers':papers}
    DATA.parent.mkdir(parents=True,exist_ok=True)
    DATA.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(f'Updated {len(papers)} papers; {added} new')

if __name__=='__main__': merge()
