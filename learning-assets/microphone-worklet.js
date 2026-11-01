class MicrophonePackets extends AudioWorkletProcessor{
  constructor(){super();this.packet=new Int16Array(1600);this.offset=0;}
  process(inputs){
    const samples=inputs[0]?.[0];if(!samples)return true;
    for(const sample of samples){
      this.packet[this.offset++]=Math.max(-32768,Math.min(32767,Math.round(sample*32768)));
      if(this.offset===1600){this.port.postMessage(this.packet.buffer,[this.packet.buffer]);this.packet=new Int16Array(1600);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('microphone-packets',MicrophonePackets);
