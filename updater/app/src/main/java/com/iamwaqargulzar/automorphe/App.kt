package com.iamwaqargulzar.automorphe

import android.app.Application
import com.iamwaqargulzar.automorphe.work.UpdateWorker

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        UpdateWorker.createChannel(this)
        UpdateWorker.schedule(this)
    }
}
