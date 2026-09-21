import json, urllib.parse, urllib.request, xml.etree.ElementTree as ET, re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'/'papers.json'
START_YEAR=2023
TZ=timezone(timedelta(hours=8))

KEYWORDS=[
 '"Google AI Overviews"','"AI Overviews" Google Search','"Search Generative Experience"','"Google SGE"',
 'Google generative search','Google AI search citations','Google AI search user behavior',
 'Google AI search publisher traffic','Google AI search SEO','Google AI search information literacy',
 'Google AI search bias fairness','Google AI search politics finance health education commerce science law travel'
]

LEVEL_RULES={
 'Query':['query','activation','trigger','question form','search term','prompt'],
 'Content':['claim','fidelity','accuracy','relevance','sentiment','stance','uncertainty','safeguard','bias','fairness'],
 'Citation':['citation','source','provenance','publisher','domain','link','attribution'],
 'Presentation':['click','traffic','zero-click','interface','snippet','user behavior','exposure','layout','seo']
}

DOMAIN_RULES={
 'Health & Medicine':['health','medical','medicine','patient','pregnancy','pharmacy','disease','clinical','hospital','drug','vaccine','mental health','nutrition'],
 'Finance & Economics':['finance','financial','bank','banking','investment','stock','market','economy','economic','insurance','tax','credit','loan','mortgage','crypto','cryptocurrency'],
 'Politics, Government & News':['politic','election','candidate','government','president','parliament','congress','policy debate','news','journalism','misinformation','public affairs'],
 'Commerce & Consumer':['shopping','commerce','e-commerce','product','consumer','retail','brand','advertising','purchase','review','recommendation'],
 'Education & Academia':['education','student','teacher','school','university','college','learning','academic','scholar','research literacy'],
 'Science & Technology':['science','technology','software','computer','ai system','artificial intelligence','engineering','climate','physics','biology','technical'],
 'Law & Public Policy':['law','legal','court','regulation','regulatory','legislation','public policy','rights','compliance'],
 'Travel, Local & Lifestyle':['travel','tourism','hotel','restaurant','local search','destination','recipe','food','lifestyle','fitness','sports','entertainment']
}

TOPIC_RULES={
 'SEO & Publishers':['seo','publisher','traffic','website','content ecosystem'],
 'User Behavior':['user behavior','click','zero-click','trust','information seeking','think-aloud'],
 'Information Literacy':['information literacy','ai literacy','source evaluation','library'],
 'Bias & Fairness':['bias','fairness','gender','race','representation'],
 'Citation & Provenance':['citation','source','provenance','attribution'],
 'Technical Evaluation':['benchmark','evaluation','accuracy','fidelity','retrieval','ranking'],
 'Safety & Risk':['safety','risk','harm','misinformation','safeguard'],
 'Platform & Interface':['interface','layout','presentation','snippet','overview design']
}

def get_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'AIO-Research-Watch/1.2 (academic literature monitor)'})
    with urllib.request.urlopen(req,timeout=30) as r: return json.loads(r.read().decode('utf-8'))

def get_text(url):
    req=urllib.request.Request(url,headers={'User-Agent':'AIO-Research-Watch/1.2 (academic literature monitor)'})
    with urllib.request.urlopen(req,timeout=30) as r: return r.read().decode('utf-8','ignore')

def norm(s): return re.sub(r'\s+',' ',(s or '')).strip()
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')[:90]

def classify(text):
    t=text.lower(); out=[]
    for level,words in LEVEL_RULES.items():
        if any(w in t for w in words): out.append(level)
    return out or ['Content']

def domains(text):
    t=text.lower(); out=[]
    for domain,words in DOMAIN_RULES.items():
        if any(w in t for w in words): out.append(domain)
    return out or ['General / Cross-domain']

def topics(text):
    t=text.lower(); out=[]
    for topic,words in TOPIC_RULES.items():
        if any(w in t for w in words): out.append(topic)
    return out or ['General AIO']

def relevant(title,abstract):
    t=(title+' '+abstract).lower()
    direct=('google ai overview' in t or 'google ai overviews' in t or 'ai overviews' in t or 'search generative experience' in t or 'google sge' in t)
    adjacent=('google' in t and ('generative search' in t or 'ai search' in t))
    return direct or adjacent

def make_record(ident,title,authors,date,venue,ptype,doi,record,pdf,abstract,source):
    fulltext=title+' '+abstract
    return {'id':ident,'title':title,'authors':authors,'date':date,'venue':venue,'type':ptype,'doi':doi,'record':record,'pdf':pdf,
            'abstract':norm(abstract),'levels':classify(fulltext),'domains':domains(fulltext),'topics':topics(fulltext),
            'source':source,'first_detected':datetime.now(TZ).date().isoformat()}

def scan_openalex():
    found=[]
    for q in KEYWORDS:
        params={'search':q.replace('"',''),'filter':f'from_publication_date:{START_YEAR}-01-01','sort':'publication_date:desc','per-page':'100'}
        url='https://api.openalex.org/works?'+urllib.parse.urlencode(params)
        try: data=get_json(url)
        except Exception: continue
        for w in data.get('results',[]):
            title=norm(w.get('display_name','')); inv=w.get('abstract_inverted_index') or {}
            pairs=[]
            for word,poss in inv.items():
                for p in poss: pairs.append((p,word))
            abstract=' '.join(word for _,word in sorted(pairs)) if pairs else ''
            if not relevant(title,abstract): continue
            year=w.get('publication_year') or 0
            if year<START_YEAR: continue
            authors=[a.get('author',{}).get('display_name','') for a in w.get('authorships',[]) if a.get('author')]
            loc=w.get('primary_location') or {}; src=(loc.get('source') or {}).get('display_name') or 'OpenAlex indexed work'
            doi=(w.get('doi') or '').replace('https://doi.org/',''); best=w.get('best_oa_location') or {}; pdf=best.get('pdf_url') or ''
            record=w.get('doi') or w.get('id') or ''; date=w.get('publication_date') or f'{year}-01-01'
            ident='doi-'+doi.lower() if doi else 'openalex-'+(w.get('id','').split('/')[-1] or slug(title))
            found.append(make_record(ident,title,authors,date,src,w.get('type','article').replace('_',' ').title(),doi,record,pdf,abstract,'OpenAlex'))
    return found

def scan_arxiv():
    found=[]
    query=' OR '.join(['all:"Google AI Overviews"','all:"AI Overviews"','all:"Search Generative Experience"','all:"Google SGE"','all:"Google generative search"'])
    url='https://export.arxiv.org/api/query?'+urllib.parse.urlencode({'search_query':query,'start':0,'max_results':200,'sortBy':'submittedDate','sortOrder':'descending'})
    try: xml=get_text(url)
    except Exception: return found
    ns={'a':'http://www.w3.org/2005/Atom'}; root=ET.fromstring(xml)
    for e in root.findall('a:entry',ns):
        title=norm(e.findtext('a:title','',ns)); abstract=norm(e.findtext('a:summary','',ns))
        if not relevant(title,abstract): continue
        published=e.findtext('a:published','',ns)[:10]
        try: year=int(published[:4])
        except: year=0
        if year<START_YEAR: continue
        authors=[norm(a.findtext('a:name','',ns)) for a in e.findall('a:author',ns)]
        rid=e.findtext('a:id','',ns); arx=rid.rstrip('/').split('/')[-1]
        found.append(make_record('arxiv-'+arx,title,authors,published,'arXiv','Preprint','',rid,'https://arxiv.org/pdf/'+arx,abstract,'arXiv'))
    return found

def merge():
    existing=json.loads(DATA.read_text()) if DATA.exists() else {'papers':[]}
    old={p['id']:p for p in existing.get('papers',[])}
    title_map={slug(p.get('title','')):p['id'] for p in old.values()}
    added=0
    for p in scan_arxiv()+scan_openalex():
        key=p['id']; ts=slug(p['title'])
        if key in old: old[key].update({k:v for k,v in p.items() if v not in ('',[],None)})
        elif ts in title_map: old[title_map[ts]].update({k:v for k,v in p.items() if v not in ('',[],None)})
        else: old[key]=p; title_map[ts]=key; added+=1
    # Backfill domains/topics for historical records too.
    for p in old.values():
        fulltext=(p.get('title','')+' '+p.get('abstract',''))
        p['domains']=domains(fulltext)
        if not p.get('topics'): p['topics']=topics(fulltext)
    papers=sorted(old.values(),key=lambda x:x.get('date',''),reverse=True)
    out={'last_updated':datetime.now(TZ).isoformat(timespec='seconds'),'new_in_latest_scan':added,
         'scope':'All-domain Google AI Overviews / SGE research with multi-label application-domain classification.','papers':papers}
    DATA.parent.mkdir(parents=True,exist_ok=True); DATA.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(f'Updated {len(papers)} papers; {added} new')

if __name__=='__main__': merge()
