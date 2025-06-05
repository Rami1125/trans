# app.py - קובץ צד השרת
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS # חשוב לטיפול ב-CORS ביישומי דפדפן
import os
import io

# ייבוא ספריות Google Cloud
from google.cloud import translate_v2 as translate
from google.cloud import texttospeech

app = Flask(__name__)
CORS(app) # אפשר CORS לכל המקורות לצורך פיתוח. יש להגביל בפרודקשן.

# הגדרת משתני סביבה או נתיב לקובץ ה-credentials של Google Cloud
# os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/path/to/your/keyfile.json"

translate_client = translate.Client()
tts_client = texttospeech.TextToSpeechClient()

@app.route('/translate_and_speak', methods=['POST'])
def translate_and_speak():
    data = request.json
    text_to_translate = data.get('text')
    source_lang = data.get('source_lang') # למשל 'he' או 'th'
    target_lang = data.get('target_lang') # למשל 'he' או 'th'

    if not text_to_translate or not source_lang or not target_lang:
        return jsonify({"error": "Missing text, source_lang, or target_lang"}), 400

    try:
        # 1. תרגום הטקסט
        result = translate_client.translate(text_to_translate, source_language=source_lang, target_language=target_lang)
        translated_text = result['translatedText']

        # 2. המרה לדיבור (TTS) של הטקסט המתורגם
        synthesis_input = texttospeech.SynthesisInput(text=translated_text)
        
        # בחירת קול מתאים לשפת היעד
        if target_lang == 'he':
            voice = texttospeech.VoiceSelectionParams(language_code="he-IL", ssml_gender=textototspeech.SsmlVoiceGender.FEMALE)
        elif target_lang == 'th':
            voice = textototspeech.VoiceSelectionParams(language_code="th-TH", ssml_gender=textototspeech.SsmlVoiceGender.FEMALE)
        else:
            # ברירת מחדל או שגיאה
            return jsonify({"error": "Unsupported target language for TTS"}), 400

        audio_config = textototspeech.AudioConfig(audio_encoding=textototspeech.AudioEncoding.MP3)
        response_tts = tts_client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )

        # 3. החזרת קובץ האודיו
        audio_stream = io.BytesIO(response_tts.audio_content)
        return send_file(audio_stream, mimetype="audio/mpeg")

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # ודא שהגדרת את משתנה הסביבה GOOGLE_APPLICATION_CREDENTIALS
    # או העברת את קובץ ה-JSON של מפתח השירות שלך למקום ידוע.
    # לדוגמה:
    # export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
    app.run(debug=True, port=5000) # הפעלת השרת על פורט 5000
