import {encode64} from './crypto.js';

export const repository={owner:'rueffy-git',name:'family-tree',id:1469793768,ownerId:198278663,branch:'main',file:'docs/tree.enc.json'};
const api='https://api.github.com';
const repoPath=`/repos/${repository.owner}/${repository.name}`;
export class GitHubError extends Error {constructor(message,status){super(message);this.status=status;}}

// GitHub authorises every write. The family viewing code gives no write access.
// Credentials live only in this object and are sent only to api.github.com.
export class OwnerConnection {
  #token='';
  #fetch;
  // Native browser fetch must not receive this OwnerConnection as its receiver.
  constructor(fetcher=fetch){this.#fetch=(...args)=>fetcher(...args);this.connected=false;}
  async #request(path,options={}){
    let response;
    try{response=await this.#fetch(api+path,{...options,credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(this.#token?{Authorization:`Bearer ${this.#token}`} : {}),...(options.body?{'Content-Type':'application/json'}:{})}});}
    catch{throw new GitHubError('GitHub could not be reached. Your draft is still open. Check your connection before trying again.',0);}
    if(!response.ok){
      const messages={401:'The private GitHub key is invalid or has expired. Connect again with a current key.',403:'GitHub did not allow this action. Check that the key has Contents: Read and write for the family-tree repository.',404:'The family-tree repository or file could not be accessed.',409:'The online tree changed while you were editing. Keep a private backup of this draft, then reload the latest tree.',422:'GitHub could not save this version. Reload the latest tree before publishing again.',429:'GitHub is busy. Keep this draft open and try again shortly.'};
      throw new GitHubError(messages[response.status]||`GitHub returned an error (${response.status}). Your draft is still open.`,response.status);
    }
    return response.json();
  }
  async connect(token){
    this.disconnect();
    if(!/^github_pat_[A-Za-z0-9_]+$/.test(token.trim()))throw new Error('Use a fine-grained GitHub key, starting with github_pat_.');
    this.#token=token.trim();
    try{
      const user=await this.#request('/user');
      if(user.id!==repository.ownerId)throw new Error('Only the owner’s GitHub account can edit this tree.');
      const repo=await this.#request(repoPath);
      if(Number(repo.id)!==repository.id||repo.owner?.id!==repository.ownerId||!repo.permissions?.push)throw new Error('This account cannot publish to the family-tree repository.');
      this.connected=true;return user.login;
    }catch(error){this.disconnect();throw error;}
  }
  disconnect(){this.#token='';this.connected=false;}
  async read(){
    if(!this.connected)throw new Error('Connect your GitHub account first.');
    const file=await this.#request(`${repoPath}/contents/${repository.file}?ref=${repository.branch}`);
    if(file.type!=='file'||file.encoding!=='base64'||!file.content||typeof file.sha!=='string')throw new Error('The online tree could not be read.');
    const bytes=Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
    return {sha:file.sha,envelope:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }
  async publish(envelope,expectedSha){
    if(!this.connected)throw new Error('Connect your GitHub account before publishing.');
    const current=await this.read();
    if(current.sha!==expectedSha)throw new GitHubError('The online tree changed while you were editing. Save a private backup, then reload the latest tree.',409);
    const content=encode64(new TextEncoder().encode(JSON.stringify(envelope)+'\n'));
    try{
      const result=await this.#request(`${repoPath}/contents/${repository.file}`,{method:'PUT',body:JSON.stringify({message:'Update family tree records',branch:repository.branch,sha:expectedSha,content})});
      if(!result.commit?.sha||!result.content?.sha)throw new Error('The save response was incomplete.');
      return {sha:result.content.sha,commit:result.commit.sha};
    }catch(error){
      // A dropped response can follow a successful write. Read once; never replay it.
      if(!error.status||error.status>=500){
        try{const after=await this.read();if(JSON.stringify(after.envelope)===JSON.stringify(envelope))return {sha:after.sha,commit:null};}catch{/* Preserve the original failure. */}
        throw new Error('GitHub did not confirm the save. Keep this draft open. Reload the online tree in another tab before trying again.');
      }
      throw error;
    }
  }
}
