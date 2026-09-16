let csrf=null;
let challengeId=null;
const $=selector=>document.querySelector(selector);
const notice=message=>{$('#notice').textContent=message};

async function api(path,method='GET',body){
  const headers={'Content-Type':'application/json'};
  if(csrf && !['GET','HEAD'].includes(method))headers['X-CSRF-Token']=csrf;
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||`Request failed (${response.status})`);error.field=data.field;throw error;}
  return data;
}
function showPortal(username){
  $('#loginPanel').hidden=true;$('#portal').hidden=false;$('#logout').hidden=false;
  notice(`Signed in as ${username}`);void loadAccounts();
}
function showLogin(){
  csrf=null;challengeId=null;$('#loginPanel').hidden=false;$('#otpForm').hidden=true;
  $('#portal').hidden=true;$('#logout').hidden=true;
}
async function loadAccounts(){
  try {
    const accounts=await api('/accounts');const root=$('#accounts');root.replaceChildren();
    if(!accounts.length){const p=document.createElement('p');p.textContent='No accounts yet. Add one below.';root.append(p);return;}
    for(const account of accounts)root.append(renderAccount(account));
  }catch(error){notice(error.message);if(error.message==='Login required')showLogin()}
}
function renderAccount(a){
  const article=document.createElement('article');article.className='account';
  const heading=document.createElement('h3');heading.textContent=`${a.name} (${a.id})`;
  const badge=document.createElement('span');badge.className='badge'+(a.enabled?'':' warn');badge.textContent=a.enabled?'Enabled':'Disabled';heading.append(badge);article.append(heading);
  const details=document.createElement('div');details.className='account-meta';
  for(const [label,value] of [['Status',a.status],['Timezone',a.timezone],['5-hour reset',a.fiveHourReset||'Unknown'],['Weekly reset',a.weeklyReset||'Unknown'],['Last Usage check',a.lastUsageCheckAt||'Never'],['Last successful HI',a.lastSuccessAt||'Never'],['Work chat',a.lastWorkChatUrl||'Unknown'],['Error',a.lastError||'None']]){
    const span=document.createElement('span');span.textContent=`${label}: ${value}`;details.append(span);
  }
  article.append(details);
  const actions=document.createElement('div');actions.className='account-actions';
  function button(label,callback,className='secondary'){
    const element=document.createElement('button');element.type='button';element.className=className;element.textContent=label;
    element.addEventListener('click',async()=>{element.disabled=true;try{await callback()}catch(error){notice(error.message)}finally{element.disabled=false}});
    actions.append(element);
  }
  button('Edit',async()=>{
    const name=prompt('Display name',a.name);if(name===null)return;
    const timezone=prompt('Timezone',a.timezone);if(timezone===null)return;
    await api(`/accounts/${a.id}`,'PATCH',{name,timezone});notice('Account updated');await loadAccounts();
  });
  button('Check Usage',async()=>{await api(`/accounts/${a.id}/check`,'POST',{});notice(`Usage check queued for ${a.id}`)});
  button('Diagnose',async()=>{const result=await api(`/accounts/${a.id}/diagnose`,'POST',{});alert(JSON.stringify(result,null,2))});
  button('Trigger if due',async()=>{await api(`/accounts/${a.id}/trigger`,'POST',{});notice('Normal due and idempotency checks are running')});
  button('Open login browser',async()=>{const result=await api(`/accounts/${a.id}/login/open`,'POST',{});notice(result.instructions||result.status)});
  button('Close login browser',async()=>{await api(`/accounts/${a.id}/login/close`,'POST',{});notice('Login browser closed')});
  button(a.enabled?'Disable':'Enable',async()=>{await api(`/accounts/${a.id}/enabled`,'POST',{enabled:!a.enabled});await loadAccounts()});
  button('Logs',async()=>{const logs=await api(`/accounts/${a.id}/events`);alert(logs.map(x=>`${x.createdAt} ${x.event}: ${x.message}`).join('\n')||'No logs')});
  button('Delete',async()=>{
    const confirmed=prompt(`Delete ${a.id} and its saved Chromium session? Type the account ID to confirm.`);
    if(confirmed!==a.id)return;
    await api(`/accounts/${a.id}`,'DELETE',{confirmId:a.id});notice(`${a.id} deleted`);await loadAccounts();
  },'danger');
  article.append(actions);return article;
}

$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const element=event.currentTarget;const form=new FormData(element);
  try{const result=await api('/auth/login','POST',{username:form.get('username'),password:form.get('password')});element.reset();challengeId=result.challengeId;$('#otpForm').hidden=false;notice('Code sent to your private Telegram chat. It expires in 5 minutes.');}
  catch(error){notice(error.message)}
});
$('#otpForm').addEventListener('submit',async event=>{
  event.preventDefault();const element=event.currentTarget;const form=new FormData(element);
  try{const result=await api('/auth/verify','POST',{challengeId,code:form.get('code')});csrf=result.csrf;element.reset();$('#loginForm').reset();showPortal(result.username)}
  catch(error){notice(error.message)}
});
$('#addForm').addEventListener('submit',async event=>{
  event.preventDefault();const element=event.currentTarget;const form=new FormData(element);const errorBox=$('#addError');
  errorBox.textContent='';
  try{await api('/accounts','POST',{id:form.get('id'),name:form.get('name'),timezone:form.get('timezone')});notice('Account added. Open the login browser to authenticate ChatGPT.');element.reset();await loadAccounts()}
  catch(error){errorBox.textContent=error.message;if(error.field)element.elements.namedItem(error.field)?.focus()}
});
$('#addForm').addEventListener('input',()=>{$('#addError').textContent=''});
$('#passwordForm').addEventListener('submit',async event=>{
  event.preventDefault();const element=event.currentTarget;const form=new FormData(element);
  try{await api('/auth/password','POST',{currentPassword:form.get('currentPassword'),newPassword:form.get('newPassword')});element.reset();showLogin();notice('Password changed. Sign in again with Telegram OTP.')}
  catch(error){notice(error.message)}
});
$('#refresh').addEventListener('click',()=>void loadAccounts());
$('#logout').addEventListener('click',async()=>{try{await api('/auth/logout','POST',{})}finally{showLogin();notice('Signed out')}});
api('/auth/me').then(result=>{csrf=result.csrf;showPortal(result.username)}).catch(()=>showLogin());
