// ai-client.js - browser demo client. API keys must be injected at runtime,
// never committed to the repository or bundled into share data.
(function(){
  window.AICLIENT={
    apiKey:(window.AI_RUNTIME_API_KEY||window.ZAI_API_KEY||''),
    apiUrl:'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model:'glm-4-flash',
    // 娴佸紡璋冪敤锛岃繑鍥?ReadableStream reader
    stream:function(messages,onChunk){
      if(!this.apiKey)return Promise.reject(new Error('AI API Key not configured'));
      return fetch(this.apiUrl,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+this.apiKey
        },
        body:JSON.stringify({
          model:this.model,
          messages:messages,
          stream:true,
          temperature:0.3
        })
      }).then(function(res){
        if(!res.ok)throw new Error('AI璇锋眰澶辫触('+res.status+')');
        var reader=res.body.getReader(),decoder=new TextDecoder();
        function read(){
          return reader.read().then(function(done){
            if(done.done){onChunk(null);return;}
            var text=decoder.decode(done.value,{stream:true});
            var lines=text.split('\n');
            for(var i=0;i<lines.length;i++){
              var line=lines[i].trim();
              if(line.startsWith('data:')){
                var data=line.slice(5).trim();
                if(data==='[DONE]'){onChunk(null);return;}
                try{
                  var json=JSON.parse(data);
                  var delta=json.choices&&json.choices[0]&&json.choices[0].delta;
                  if(delta&&delta.content)onChunk(delta.content);
                }catch(e){}
              }
            }
            return read();
          });
        }
        return read();
      });
    },
    // 闈炴祦寮忚皟鐢紝杩斿洖瀹屾暣鏂囨湰
    chat:function(messages){
      if(!this.apiKey)return Promise.reject(new Error('AI API Key not configured'));
      return fetch(this.apiUrl,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+this.apiKey
        },
        body:JSON.stringify({
          model:this.model,
          messages:messages,
          temperature:0.3
        })
      }).then(function(res){
        if(!res.ok)throw new Error('AI璇锋眰澶辫触('+res.status+')');
        return res.json();
      }).then(function(data){
        return data.choices&&data.choices[0]&&data.choices[0].message?data.choices[0].message.content:'No AI response';
      });
    }
  };
})();
