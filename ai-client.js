// ai-client.js — 前端直连智谱 API（无需后端）
// Key 分段存储，增加随手翻源码的门槛
(function(){
  var _p1='58ff9cc0d7344a4b8596df01852b8ebc.';
  var _p2='SD8tLnqWUvlCyaqZ';
  window.AICLIENT={
    apiKey:_p1+_p2,
    apiUrl:'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model:'glm-4-flash',
    // 流式调用，返回 ReadableStream reader
    stream:function(messages,onChunk){
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
        if(!res.ok)throw new Error('AI请求失败('+res.status+')');
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
    // 非流式调用，返回完整文本
    chat:function(messages){
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
        if(!res.ok)throw new Error('AI请求失败('+res.status+')');
        return res.json();
      }).then(function(data){
        return data.choices&&data.choices[0]&&data.choices[0].message?data.choices[0].message.content:'（无响应）';
      });
    }
  };
})();
