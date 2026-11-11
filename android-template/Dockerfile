# Android's build tools ship for x86-64 Linux only.
FROM --platform=linux/amd64 eclipse-temurin:17-jdk-jammy@sha256:81336a07f69ac361c7f278183b195e32037ebdb532684996806265a3b47ef516

ARG VERSION_SHA
LABEL sitetoapk.version-sha="${VERSION_SHA}"

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/gradle/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/build-tools/35.0.0:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*

ADD --checksum=sha256:f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6 \
  https://services.gradle.org/distributions/gradle-8.11.1-bin.zip /tmp/gradle.zip
RUN unzip -q /tmp/gradle.zip -d /opt && mv /opt/gradle-8.11.1 /opt/gradle && rm /tmp/gradle.zip

ADD https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip /tmp/tools.zip
RUN echo "e025545c62a8e64c7559119566a569fb1dec5f60  /tmp/tools.zip" | sha1sum -c - \
  && mkdir -p /opt/android-sdk/cmdline-tools \
  && unzip -q /tmp/tools.zip -d /opt/android-sdk/cmdline-tools \
  && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
  && rm /tmp/tools.zip \
  && yes | sdkmanager --licenses > /dev/null \
  && sdkmanager "platforms;android-35" "build-tools;35.0.0" "build-tools;34.0.0" > /dev/null

# Checks the bundle a Premium build makes.
ADD --checksum=sha256:2d4ad908faea64047c1cc9cb747e6aa667c6ab192e09607bd16b67246a8cd6ae \
  https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar /opt/bundletool.jar

COPY app /opt/template/app
COPY gradle /opt/template/gradle
COPY sample /opt/template/sample
COPY build.gradle.kts settings.gradle.kts gradle.properties version.json /opt/template/
COPY builder/build.sh builder/verify.sh builder/keygen.sh /opt/builder/

# Fills the dependency cache once, then keeps only the part that is safe to share read-only.
RUN cd /opt/template \
  && GRADLE_USER_HOME=/tmp/gradle-warm gradle assembleRelease bundleRelease --no-daemon --console=plain \
    -PapplicationId=com.sitetoapk.warm -PversionCode=1 -PversionName=1.0 -PgeneratedDir=/opt/template/sample \
  && mkdir -p /opt/gradle-ro/modules-2 \
  && cp -r /tmp/gradle-warm/caches/modules-2/files-2.1 /tmp/gradle-warm/caches/modules-2/metadata-* /opt/gradle-ro/modules-2/ \
  && find /opt/gradle-ro -name '*.lock' -delete \
  && find /opt/gradle-ro -name 'gc.properties' -delete \
  && rm -rf /tmp/gradle-warm /opt/template/app/build /opt/template/.gradle /opt/template/.kotlin /root/.android \
  && chmod -R a+rX /opt

USER 1000:1000
ENTRYPOINT ["/opt/builder/build.sh"]
