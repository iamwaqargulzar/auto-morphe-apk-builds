# kotlinx.serialization keeps generated serializers via its own rules; keep feed models readable in crash traces.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.iamwaqargulzar.automorphe.data.**$$serializer { *; }
-keepclassmembers class com.iamwaqargulzar.automorphe.data.** { *** Companion; }
