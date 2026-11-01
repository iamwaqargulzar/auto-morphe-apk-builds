package com.iamwaqargulzar.automorphe.extension;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import java.lang.reflect.Field;

/**
 * Runs inside patched Telegram. Before the first connection starts, it reads
 * the user's own api_id / api_hash from Auto Morphe and puts them into
 * BuildVars. Telegram rejects the official app's ID from modified clients.
 *
 * The last answer is cached in Telegram's own prefs, so Telegram still signs
 * in if Auto Morphe is missing. If Auto Morphe says there are none (the user
 * removed them), the cache is cleared and Telegram keeps its defaults.
 * The values are never logged.
 */
@SuppressWarnings("unused")
public final class TelegramApi {
    private static final String TAG = "AutoMorphe";
    private static final Uri URI = Uri.parse("content://com.iamwaqargulzar.automorphe.telegram/credentials");

    private static boolean loaded;
    private static int appliedId;

    private TelegramApi() {
    }

    /** Called at the start of ConnectionsManager's constructor, before BuildVars.APP_ID is read. */
    public static synchronized void apply() {
        if (loaded) return;
        Context context = context();
        if (context == null) return;
        loaded = true;
        try {
            SharedPreferences cache = context.getSharedPreferences("automorphe_api", Context.MODE_PRIVATE);
            int id = 0;
            String hash = null;
            boolean answered = false;
            try (Cursor cursor = context.getContentResolver().query(URI, null, null, null, null)) {
                if (cursor != null) {
                    answered = true;
                    if (cursor.moveToFirst()) {
                        id = cursor.getInt(0);
                        hash = cursor.getString(1);
                    }
                }
            } catch (Throwable t) {
                Log.w(TAG, "Auto Morphe not reachable; using the saved API credentials");
            }
            if (answered) {
                if (valid(id, hash)) {
                    cache.edit().putInt("id", id).putString("hash", hash).apply();
                } else {
                    cache.edit().clear().apply();
                }
            } else {
                id = cache.getInt("id", 0);
                hash = cache.getString("hash", null);
            }
            if (!valid(id, hash)) {
                Log.w(TAG, "No API credentials from Auto Morphe; open Auto Morphe and set up Telegram");
                return;
            }
            Class<?> buildVars = Class.forName("org.telegram.messenger.BuildVars");
            buildVars.getField("APP_ID").setInt(null, id);
            buildVars.getField("APP_HASH").set(null, hash);
            appliedId = id;
            Log.i(TAG, "Using your own API credentials from Auto Morphe");
        } catch (Throwable t) {
            Log.e(TAG, "Couldn't apply the API credentials", t);
        }
    }

    /**
     * Mixes the API ID into the version given to the native layer, so a changed
     * ID makes Telegram send a fresh initConnection. Same values as HushTelegram's
     * "Use registered Telegram API credentials" patch, so switching between the
     * two with the same ID keeps the connection state.
     */
    public static int version(int version) {
        apply();
        int id = appliedId;
        if (id == 0) return version;
        int mixed = version ^ id;
        return mixed != 0 ? mixed : ~(id ^ 0x80);
    }

    private static boolean valid(int id, String hash) {
        return id > 0 && hash != null && hash.matches("[0-9a-fA-F]{32}");
    }

    private static Context context() {
        try {
            Field field = Class.forName("org.telegram.messenger.ApplicationLoader").getField("applicationContext");
            Object value = field.get(null);
            if (value instanceof Context) return (Context) value;
        } catch (Throwable ignored) {
        }
        try {
            Object app = Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null);
            if (app instanceof Context) return (Context) app;
        } catch (Throwable ignored) {
        }
        return null;
    }
}
