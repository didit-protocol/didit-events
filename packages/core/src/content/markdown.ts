import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { YOUTUBE_EMBED_ALLOW,YOUTUBE_EMBED_SRC,YOUTUBE_EMBED_STYLE,YOUTUBE_EMBED_TITLE,youtubeEmbedSrc } from "./youtube.ts";
const parser = new MarkdownIt({html:false,linkify:false,typographer:false});
Object.assign(parser.options,{maxNesting:20});
// A top-level line that is only a YouTube link: a video embed on the page (our own iframe, never the author's HTML;
// the sanitizer below rebuilds it and accepts no other origin), a plain link in emails.
parser.core.ruler.after("block","youtube_embed",state=>{
  const out:typeof state.tokens=[];
  for(let i=0;i<state.tokens.length;i++){
    const open=state.tokens[i]!,inline=state.tokens[i+1],close=state.tokens[i+2];
    const lines=open.type==="paragraph_open"&&open.level===0&&inline?.type==="inline"&&close?.type==="paragraph_close"?inline.content.split("\n"):[];
    if(!lines.some(youtubeEmbedSrc)){out.push(open);continue;}
    i+=2;
    if(state.env?.email){inline!.content=lines.map(l=>youtubeEmbedSrc(l)?`<${l.trim()}>`:l).join("\n");out.push(open,inline!,close!);continue;}
    const paragraph=(text:string[])=>{
      if(!text.length)return;
      const body=new state.Token("inline","",0);
      Object.assign(body,{content:text.join("\n"),map:inline!.map,level:1,children:[]});
      out.push(Object.assign(new state.Token("paragraph_open","p",1),{block:true,map:open.map}),body,Object.assign(new state.Token("paragraph_close","p",-1),{block:true}));
    };
    let text:string[]=[];
    for(const line of lines){
      const src=youtubeEmbedSrc(line);
      if(!src){text.push(line);continue;}
      paragraph(text);text=[];
      out.push(Object.assign(new state.Token("html_block","",0),{block:true,content:`<iframe src="${src}"></iframe>\n`}));
    }
    paragraph(text);
  }
  state.tokens=out;
});
const safeHttps = (value:string) => { try {const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password;}catch{return false;} };
export function renderSafeMarkdown(source:string,options:{email?:boolean}={}):string {
  if(typeof source!=="string" || [...source].length>20_000 || Buffer.byteLength(source)>80_000)throw new Error("MarkdownTooLarge");
  return sanitizeRenderedMarkdown(parser.render(source,{email:!!options.email}),options);
}
/** The allowlist every rendered description goes through. The parser never passes raw HTML on; this holds without it. */
export function sanitizeRenderedMarkdown(html:string,options:{email?:boolean}={}):string {
  return sanitizeHtml(html,{
    allowedTags:["p","h2","h3","h4","ul","ol","li","strong","em","blockquote","code","pre","a","br",...(options.email?[]:["img","iframe"])],
    allowedAttributes:{a:["href","title","rel"],img:["src","alt","title","loading","referrerpolicy","style"],iframe:["src","title","loading","allow","allowfullscreen","referrerpolicy","style"]},
    allowedSchemes:["https"],allowProtocolRelative:false,allowedIframeHostnames:["www.youtube-nocookie.com"],allowIframeRelativeUrls:false,
    transformTags:{h1:"h2",h5:"h4",h6:"h4",a:(_tag,attrs)=>({tagName:"a",attribs:{...(safeHttps(attrs.href??"")?{href:attrs.href!}:{}),...(attrs.title?{title:attrs.title}:{}),rel:"noopener noreferrer nofollow"}}),
      img:(_tag,attrs)=>({tagName:"img",attribs:{...(safeHttps(attrs.src??"")?{src:attrs.src!}:{}),alt:attrs.alt??"",loading:"lazy",referrerpolicy:"no-referrer",style:"max-width:100%;height:auto;max-height:640px"}}),
      iframe:(_tag,attrs):{tagName:string;attribs:Record<string,string>}=>({tagName:"iframe",attribs:YOUTUBE_EMBED_SRC.test(attrs.src??"")?{src:attrs.src!,title:YOUTUBE_EMBED_TITLE,loading:"lazy",allow:YOUTUBE_EMBED_ALLOW,allowfullscreen:"",referrerpolicy:"strict-origin-when-cross-origin",style:YOUTUBE_EMBED_STYLE}:{}})},
    allowedStyles:{img:{"max-width":[/^100%$/],height:[/^auto$/],"max-height":[/^640px$/]},
      iframe:{display:[/^block$/],width:[/^100%$/],"aspect-ratio":[/^16 \/ 9$/],height:[/^auto$/],border:[/^0$/],"border-radius":[/^12px$/]}},
    exclusiveFilter:frame=>(frame.tag==="img"||frame.tag==="iframe")&&!frame.attribs.src,
  });
}
export const escapeMarkdownValue=(value:unknown)=>String(value??"").replace(/[\\`*_{}\[\]()#+\-.!<>|&]/g,c=>`&#${c.charCodeAt(0)};`).replace(/[\r\n]/g," ");
export function interpolateEditorial(source:string,values:Record<string,unknown>,markdown=false) {
  return source.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(_match,key:string)=>markdown?escapeMarkdownValue(values[key]):String(values[key]??"").replace(/[\r\n]/g," "));
}
