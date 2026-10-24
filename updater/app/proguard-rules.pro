# kotlinx.serialization keeps generated serializers via its own rules; keep feed models readable in crash traces.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.iamwaqargulzar.automurph.data.**$$serializer { *; }
-keepclassmembers class com.iamwaqargulzar.automurph.data.** { *** Companion; }
