(function(root){
  const DAY=86400000;
  const dateKey=value=>String(value||'').slice(0,10);
  const atNoon=value=>{const key=dateKey(value);return key?new Date(`${key}T12:00:00`):null};
  const daysBetween=(from,to)=>Math.round((to-from)/DAY);
  const nameOf=contact=>`${contact?.first_name||''} ${contact?.last_name||''}`.trim()||'Unnamed contact';
  const isOpen=value=>!['completed','cancelled','closed','done'].includes(String(value||'open').toLowerCase());

  function buildAssistantInsights(data={},nowValue=new Date()){
    const now=new Date(nowValue),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),todayKey=dateKey(today.toISOString());
    const contacts=data.contacts||[],tasks=data.tasks||[],transactions=data.transactions||[],listings=data.listings||[],opportunities=data.opportunities||[],activities=data.activities||[];
    const items=[],contactById=new Map(contacts.map(contact=>[Number(contact.id),contact]));
    const add=item=>items.push(item);

    for(const task of tasks){
      if(task._calendar||!isOpen(task.status)||!task.due_at)continue;
      const due=atNoon(task.due_at);if(!due)continue;
      const days=daysBetween(today,due),person=task.contact_name||nameOf(contactById.get(Number(task.contact_id))),context=person==='Unnamed contact'?'':` for ${person}`;
      if(days<0)add({score:110-days,title:task.title||'Untitled task',detail:`Overdue by ${Math.abs(days)} day${Math.abs(days)===1?'':'s'}${context}.`,reason:'Overdue commitments are the highest risk for missed client service.',route:'tasks',kind:'task',id:task.id});
      else if(days===0)add({score:105,title:task.title||'Untitled task',detail:`Due today${context}.`,reason:'This is due before the day ends.',route:'tasks',kind:'task',id:task.id});
      else if(days<=7)add({score:65-days,title:task.title||'Untitled task',detail:`Due in ${days} day${days===1?'':'s'}${context}.`,reason:'Preparing early reduces last-minute work.',route:'tasks',kind:'task',id:task.id});
    }

    for(const contact of contacts){
      if(!contact.next_follow_up)continue;
      const due=atNoon(contact.next_follow_up);if(!due)continue;
      const days=daysBetween(today,due),name=nameOf(contact);
      if(days<0)add({score:102-days,title:`Follow up with ${name}`,detail:`Follow-up is ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue.`,reason:'A promised follow-up is waiting and can affect trust.',route:'contacts',kind:'contact',id:contact.id});
      else if(days===0)add({score:100,title:`Follow up with ${name}`,detail:'Follow-up is due today.',reason:'This contact is scheduled for attention today.',route:'contacts',kind:'contact',id:contact.id});
      else if(days<=3)add({score:62-days,title:`Prepare for ${name}`,detail:`Follow-up is due in ${days} day${days===1?'':'s'}.`,reason:'A quick review now makes the conversation more useful.',route:'contacts',kind:'contact',id:contact.id});
    }

    const deadlines=[['inspection_date','Inspection'],['appraisal_date','Appraisal'],['financing_deadline','Financing deadline'],['final_walkthrough_date','Final walk-through'],['closing_date','Closing']];
    for(const transaction of transactions){
      if(['cancelled','closed'].includes(String(transaction.status||'').toLowerCase()))continue;
      for(const [field,label] of deadlines){
        const due=atNoon(transaction[field]);if(!due)continue;
        const days=daysBetween(today,due);if(days<0||days>14)continue;
        add({score:days<=3?96-days:74-days,title:`${label}: ${transaction.property||'Transaction'}`,detail:days===0?'Scheduled for today.':`Scheduled in ${days} day${days===1?'':'s'}.`,reason:days<=3?'This deadline is close and should be confirmed.':'This upcoming milestone may require preparation.',route:'transactions',kind:'transaction',id:transaction.id});
      }
    }

    for(const listing of listings){
      if(!['active','coming soon'].includes(String(listing.status||'').toLowerCase()))continue;
      const listed=atNoon(listing.listing_date||listing.listed_at||listing.created_at),age=listed?daysBetween(listed,today):null,showings=Number(listing.showings||0),offers=Number(listing.offers||0);
      if(age!==null&&age>=7&&showings===0)add({score:58+Math.min(age,20)/10,title:`Review ${listing.address}`,detail:`Active for ${age} days with no showings recorded.`,reason:'This may be a signal to review presentation, exposure, price, or showing feedback.',route:'listings',kind:'listing',id:listing.id});
      else if(age!==null&&age>=21&&offers===0)add({score:54,title:`Check strategy for ${listing.address}`,detail:`Active for ${age} days with no offers recorded.`,reason:'A longer market period without offers deserves a strategy check.',route:'listings',kind:'listing',id:listing.id});
    }

    const activityByContact=new Map();
    for(const activity of activities){const id=Number(activity.contact_id),key=dateKey(activity.occurred_at);if(id&&key&&(!activityByContact.get(id)||key>activityByContact.get(id)))activityByContact.set(id,key)}
    for(const opportunity of opportunities){
      if(!isOpen(opportunity.status)||String(opportunity.stage||'').toLowerCase().includes('closed'))continue;
      const contact=contactById.get(Number(opportunity.contact_id));if(!contact||contact.next_follow_up)continue;
      const last=atNoon(contact.last_contact||activityByContact.get(Number(contact.id))),days=last?daysBetween(last,today):null;
      if(days===null||days>=14)add({score:48+(days===null?5:Math.min(days,30)/10),title:`Reconnect with ${nameOf(contact)}`,detail:days===null?'No recent contact is recorded.':`Last contact was ${days} days ago.`,reason:'This active opportunity has no next follow-up scheduled.',route:'contacts',kind:'contact',id:contact.id});
    }

    items.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
    const unique=[],seen=new Set();for(const item of items){const key=`${item.kind}:${item.id}:${item.title}`;if(seen.has(key))continue;seen.add(key);unique.push(item);if(unique.length===7)break}
    const urgent=unique.filter(item=>item.score>=90).length;
    return {date:todayKey,urgent,total:unique.length,items:unique,headline:urgent?`${urgent} item${urgent===1?'':'s'} need immediate attention.`:unique.length?`${unique.length} useful next step${unique.length===1?'':'s'} found.`:'Your CRM does not show any urgent work right now.'};
  }

  root.CrmAssistantReasoning={buildAssistantInsights};
})(typeof globalThis!=='undefined'?globalThis:this);
