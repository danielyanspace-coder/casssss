package com.luckybox.gateway

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Telephony
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*
import androidx.work.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object Gateway {
  private val http=OkHttpClient.Builder().callTimeout(20,TimeUnit.SECONDS).build()
  fun config(c:Context):Triple<String,String,String>{val p=c.getSharedPreferences("gateway",0);return Triple(p.getString("url","")!!,p.getString("id","")!!,p.getString("secret","")!!)}
  fun send(c:Context,path:String,body:String):Boolean {
    return try{
    val(url,id,secret)=config(c);if(!url.startsWith("https://")||id.isBlank()||secret.length<24)false else {
    val ts=System.currentTimeMillis().toString();val nonce=UUID.randomUUID().toString();val mac=Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(),"HmacSHA256"));val sig=mac.doFinal("$ts.$nonce.$body".toByteArray()).joinToString(""){"%02x".format(it)}
    val req=Request.Builder().url(url.trimEnd('/')+path).post(body.toRequestBody("application/json".toMediaType())).header("X-Device-Id",id).header("X-Timestamp",ts).header("X-Nonce",nonce).header("X-Signature",sig).build()
    http.newCall(req).execute().use{it.isSuccessful}
    }}catch(_:Exception){false}
  }
  fun heartbeat(c:Context)=WorkManager.getInstance(c).enqueueUniquePeriodicWork("heartbeat",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<HeartbeatWorker>(15,TimeUnit.MINUTES).build())
}

class SmsUploadWorker(c:Context,p:WorkerParameters):Worker(c,p){override fun doWork()=inputData.getString("body")?.let{if(Gateway.send(applicationContext,"/api/webhooks/beeline",it))Result.success()else Result.retry()}?:Result.failure()}
class HeartbeatWorker(c:Context,p:WorkerParameters):Worker(c,p){override fun doWork()=if(Gateway.send(applicationContext,"/api/webhooks/beeline/heartbeat","{}"))Result.success()else Result.retry()}
class BootReceiver:BroadcastReceiver(){override fun onReceive(c:Context,i:Intent){Gateway.heartbeat(c)}}

class SmsReceiver:BroadcastReceiver(){override fun onReceive(c:Context,i:Intent){
  for(sms in Telephony.Sms.Intents.getMessagesFromIntent(i)){
    if(!sms.displayOriginatingAddress.equals("beelineOFD",true))continue
    val text=sms.displayMessageBody;val m=Regex("Чек\\s+билайн[а]?\\s+(\\d+)(?:[.,](\\d{1,2}))?\\s*руб",RegexOption.IGNORE_CASE).find(text)?:continue
    val kop=(m.groupValues.getOrNull(2)?:"").padEnd(2,'0').take(2);if(kop!="00")continue
    val safe=text.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n");val id=Gateway.config(c).second
    val body="{\"amount\":${m.groupValues[1]},\"message\":\"$safe\",\"device_id\":\"$id\"}"
    val work=OneTimeWorkRequestBuilder<SmsUploadWorker>().setInputData(workDataOf("body" to body)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,15,TimeUnit.SECONDS).build()
    WorkManager.getInstance(c).enqueueUniqueWork("sms-${sms.timestampMillis}-${text.hashCode()}",ExistingWorkPolicy.KEEP,work)
  }
}}

class MainActivity:Activity(){
  private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()
  private fun bg(color:Int,r:Int=16,stroke:Int?=null)=GradientDrawable().apply{setColor(color);cornerRadius=dp(r).toFloat();stroke?.let{setStroke(dp(1),it)}}
  override fun onCreate(b:Bundle?){super.onCreate(b);window.statusBarColor=Color.rgb(18,13,28);window.navigationBarColor=Color.rgb(18,13,28)
    val scroll=ScrollView(this).apply{setBackgroundColor(Color.rgb(18,13,28))};val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(22),dp(34),dp(22),dp(28))};scroll.addView(root)
    val logo=TextView(this).apply{text="LB";textSize=21f;gravity=Gravity.CENTER;setTextColor(Color.rgb(25,19,33));typeface=Typeface.DEFAULT_BOLD;background=bg(Color.rgb(255,214,10))};root.addView(logo,LinearLayout.LayoutParams(dp(56),dp(56)))
    root.addView(TextView(this).apply{text="Платёжный шлюз";textSize=28f;setTextColor(Color.WHITE);typeface=Typeface.DEFAULT_BOLD;setPadding(0,dp(17),0,dp(4))})
    root.addView(TextView(this).apply{text="LuckyBox · автоматическое зачисление Beeline";textSize=14f;setTextColor(Color.rgb(177,164,194));setPadding(0,0,0,dp(20))})
    val card=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(18),dp(18),dp(18),dp(18));background=bg(Color.rgb(31,23,43),18,Color.rgb(74,57,94))};root.addView(card,LinearLayout.LayoutParams(-1,-2))
    val status=TextView(this).apply{text="● Требуется настройка";textSize=16f;setTextColor(Color.rgb(255,214,10));typeface=Typeface.DEFAULT_BOLD;setPadding(0,0,0,dp(10))};card.addView(status)
    fun field(label:String,hint:String,key:String,secret:Boolean=false):EditText{card.addView(TextView(this).apply{text=label;textSize=12f;setTextColor(Color.rgb(177,164,194));setPadding(0,dp(10),0,dp(6))});return EditText(this).apply{this.hint=hint;setHintTextColor(Color.rgb(125,112,143));setTextColor(Color.WHITE);setSingleLine();setPadding(dp(13),0,dp(13),0);background=bg(Color.rgb(23,17,31),12,Color.rgb(74,57,94));inputType=if(secret)InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI;setText(getSharedPreferences("gateway",0).getString(key,""));card.addView(this,ViewGroup.LayoutParams(-1,dp(52)))}}
    val url=field("Адрес сервера","https://ваш-домен.ru","url");val id=field("ID устройства","beeline-1","id");val secret=field("Секретный ключ","Минимум 24 символа","secret",true)
    val save=Button(this).apply{text="СОХРАНИТЬ И ПРОВЕРИТЬ";textSize=13f;setTextColor(Color.rgb(25,19,33));typeface=Typeface.DEFAULT_BOLD;background=bg(Color.rgb(255,214,10),13)};card.addView(save,LinearLayout.LayoutParams(-1,dp(54)).apply{topMargin=dp(20)})
    root.addView(TextView(this).apply{text="Как настроить\n1. Создайте устройство в админке LuckyBox.\n2. Вставьте адрес сайта, ID и секрет.\n3. Разрешите получение SMS.\n4. Нажмите кнопку проверки.";textSize=14f;setTextColor(Color.rgb(177,164,194));setLineSpacing(0f,1.25f);setPadding(dp(4),dp(22),dp(4),0)})
    setContentView(scroll);if(checkSelfPermission(Manifest.permission.RECEIVE_SMS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS,Manifest.permission.READ_SMS),10)
    save.setOnClickListener{getSharedPreferences("gateway",0).edit().putString("url",url.text.toString().trim()).putString("id",id.text.toString().trim()).putString("secret",secret.text.toString()).apply();status.text="● Проверяем…";Thread{val ok=Gateway.send(this,"/api/webhooks/beeline/heartbeat","{}");runOnUiThread{status.text=if(ok)"● Подключено и готово" else "● Нет подключения — проверьте данные";status.setTextColor(if(ok)Color.rgb(83,225,151)else Color.rgb(255,101,117))}}.start();Gateway.heartbeat(this)}
  }
}
